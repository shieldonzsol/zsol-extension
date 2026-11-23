// Reads a Rings `transact` instruction before it is sent: its public legs and each new output's
// owner tag and ciphertext. The SDK encodes this instruction but has no decoder; the layout
// mirrors its encoder: little-endian integers, a u8 count before each list, a u16 length before
// each byte vector, a presence byte before each option. The proof after the outputs isn't read.
import { SHIELDED_POOL_PROGRAM_ID } from "@heliuslabs/spr";
import { InstructionTag } from "@heliuslabs/spr/interface";
import {
  address,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  type Transaction,
} from "@solana/kit";

export type PublicLegKind = "solDeposit" | "solWithdrawal" | "splDeposit" | "splWithdrawal";

export interface PublicLeg {
  readonly kind: PublicLegKind;
  readonly amount: bigint;
}

export type OwnerTag =
  | { readonly kind: "inline"; readonly value: Uint8Array }
  | { readonly kind: "account"; readonly index: number };

export interface TransactOutput {
  readonly utxoHash: Uint8Array;
  readonly ownerTag: OwnerTag;
  /** Its ciphertext; absent when a preceding output's covers it. */
  readonly data?: Uint8Array;
}

export interface TransactView {
  readonly expiryUnixTs: bigint;
  readonly txViewingPublicKey: Uint8Array;
  readonly salt: Uint8Array;
  readonly publicLegs: readonly PublicLeg[];
  readonly outputs: readonly TransactOutput[];
}

export class TransactDecodeError extends Error {
  override readonly name = "TransactDecodeError";
  constructor(
    readonly code: "not-transact" | "truncated" | "unknown-tag",
    message: string,
  ) {
    super(message);
  }
}

class Cursor {
  #offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  take(length: number): Uint8Array {
    if (this.#offset + length > this.bytes.length) {
      throw new TransactDecodeError("truncated", "The transact instruction ends early.");
    }
    const slice = this.bytes.slice(this.#offset, this.#offset + length);
    this.#offset += length;
    return slice;
  }

  u8(): number {
    return this.take(1)[0] ?? 0;
  }

  u16(): number {
    const [low = 0, high = 0] = this.take(2);
    return low | (high << 8);
  }

  u64(): bigint {
    return this.take(8).reduceRight((value, byte) => (value << 8n) | BigInt(byte), 0n);
  }

  option<T>(read: () => T): T | undefined {
    const present = this.u8();
    if (present > 1) throw new TransactDecodeError("unknown-tag", "An option flag is not 0 or 1.");
    return present === 1 ? read() : undefined;
  }
}

const LEG_KINDS: readonly PublicLegKind[] = [
  "solDeposit",
  "solWithdrawal",
  "splDeposit",
  "splWithdrawal",
];

/** Decodes a transact instruction's data, the leading instruction tag included. */
export function decodeTransact(data: Uint8Array): TransactView {
  const cursor = new Cursor(data);
  if (cursor.u8() !== InstructionTag.transact) {
    throw new TransactDecodeError("not-transact", "This is not a Rings transact instruction.");
  }
  const expiryUnixTs = cursor.u64();
  const txViewingPublicKey = cursor.take(33);
  const salt = cursor.take(16);
  const publicLegs: PublicLeg[] = [];
  for (let count = cursor.u8(); count > 0; count--) {
    const kind = LEG_KINDS[cursor.u8()];
    if (!kind) throw new TransactDecodeError("unknown-tag", "Unknown public leg kind.");
    const amount = cursor.u64();
    if (kind === "splDeposit" || kind === "splWithdrawal") cursor.u8();
    publicLegs.push({ kind, amount });
  }
  cursor.option(() => cursor.take(32));
  cursor.option(() => cursor.take(32));
  const outputs: TransactOutput[] = [];
  for (let count = cursor.u8(); count > 0; count--) {
    const utxoHash = cursor.take(32);
    const tagKind = cursor.u8();
    let ownerTag: OwnerTag;
    if (tagKind === 0) ownerTag = { kind: "inline", value: cursor.take(32) };
    else if (tagKind === 1) ownerTag = { kind: "account", index: cursor.u8() };
    else throw new TransactDecodeError("unknown-tag", "Unknown owner tag kind.");
    const ciphertext = cursor.option(() => cursor.take(cursor.u16()));
    outputs.push({ utxoHash, ownerTag, ...(ciphertext ? { data: ciphertext } : {}) });
  }
  return { expiryUnixTs, txViewingPublicKey, salt, publicLegs, outputs };
}

export interface RingsInstruction {
  readonly view: TransactView;
  /** The instruction's accounts in order, as bytes: owner tags of kind `account` point here. */
  readonly accounts: readonly Uint8Array[];
}

const addressBytes = getAddressEncoder();

/** The Rings `transact` instruction in a compiled transaction, signed or not. */
export function ringsTransactOf(
  transaction: Pick<Transaction, "messageBytes">,
): RingsInstruction | undefined {
  const program: string = SHIELDED_POOL_PROGRAM_ID;
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const keys: readonly string[] = message.staticAccounts;
  const instructions =
    "instructionHeaders" in message
      ? message.instructionHeaders.map((header, index) => ({
          program: header.programAccountIndex,
          accounts: message.instructionPayloads[index]?.instructionAccountIndices ?? [],
          data: message.instructionPayloads[index]?.instructionData,
        }))
      : message.instructions.map((instruction) => ({
          program: instruction.programAddressIndex,
          accounts: instruction.accountIndices ?? [],
          data: instruction.data,
        }));
  for (const instruction of instructions) {
    if (keys[instruction.program] !== program) continue;
    const data = instruction.data ? new Uint8Array(instruction.data) : new Uint8Array();
    if (data[0] !== InstructionTag.transact) continue;
    return {
      view: decodeTransact(data),
      accounts: instruction.accounts.map(
        (index: number) => new Uint8Array(addressBytes.encode(address(keys[index] ?? program))),
      ),
    };
  }
  return undefined;
}
