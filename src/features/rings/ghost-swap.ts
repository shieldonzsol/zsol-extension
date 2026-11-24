// A ghost wallet's swap, built whole by zSol's server and co-signed by zSol's fee wallet: Jupiter's
// route for the ghost wallet, which pays its own network fee and token accounts; zSol's 1.5% in
// SOL; and zSol's signature on an empty memo. The panel checks it here before the ghost key signs.
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  pipe,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type Transaction,
  type V1TransactionConfig,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

import { ASSOCIATED_TOKEN_PROGRAM, swapInstructionsForKit, type TradeSwap } from "./trade";

const JUPITER_SWAP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** SPL Memo v2: every account it names must sign. */
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const SYSTEM_TRANSFER = 2;
const TOKEN_SYNC_NATIVE = 17;
const TOKEN_CLOSE_ACCOUNT = 9;
const TOKEN_PROGRAMS: ReadonlySet<string> = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);
/** Associated Token Account `Create` (no data or 0) and `CreateIdempotent` (1). */
const ATA_CREATES = new Set([0, 1]);

export interface GhostSwapParts {
  /** The ghost wallet: the fee payer and the swap's owner. */
  readonly ghost: Address;
  /** zSol's fee wallet: it co-signs and pays nothing. */
  readonly cosigner: Address;
  /** Where zSol's 1.5% goes. */
  readonly feeTo: Address;
  /** zSol's 1.5%, in lamports. */
  readonly fee: bigint;
  readonly swap: TradeSwap;
  /** Selling all of a classic token: its emptied account, closed to the ghost wallet. */
  readonly closes?: Address;
  readonly lifetime: {
    readonly blockhash: Blockhash;
    readonly lastValidBlockHeight: bigint;
  };
  readonly config: V1TransactionConfig;
}

/** The ghost wallet's swap as one version 1 transaction, unsigned. */
export function ghostSwapTransaction(parts: GhostSwapParts): Transaction {
  const close: Instruction[] = parts.closes
    ? [
        {
          programAddress: address(TOKEN_PROGRAM),
          accounts: [
            { address: parts.closes, role: AccountRole.WRITABLE },
            { address: parts.ghost, role: AccountRole.WRITABLE },
            { address: parts.ghost, role: AccountRole.READONLY_SIGNER },
          ],
          data: new Uint8Array([TOKEN_CLOSE_ACCOUNT]),
        },
      ]
    : [];
  return compileTransaction(
    pipe(
      createTransactionMessage({ version: 1 }),
      (message) => setTransactionMessageFeePayer(parts.ghost, message),
      (message) => setTransactionMessageLifetimeUsingBlockhash(parts.lifetime, message),
      (message) => setTransactionMessageConfig(parts.config, message),
      (message) =>
        appendTransactionMessageInstructions(
          [
            ...swapInstructionsForKit(parts.swap),
            ...close,
            // zSol's 1.5%, after the swap: a sale pays it from what it brought.
            getTransferSolInstruction({
              source: createNoopSigner(parts.ghost),
              destination: parts.feeTo,
              amount: parts.fee,
            }),
            {
              programAddress: address(MEMO_PROGRAM),
              accounts: [{ address: parts.cosigner, role: AccountRole.READONLY_SIGNER }],
              data: new Uint8Array(),
            },
          ],
          message,
        ),
    ),
  );
}

export class GhostSwapRefused extends Error {
  override readonly name = "GhostSwapRefused";
}

const refuse = (message: string): never => {
  throw new GhostSwapRefused(message);
};

/**
 * Checks a ghost wallet's swap before its key signs: the ghost wallet pays, only it and zSol's fee
 * wallet sign, zSol's fee wallet only on the memo; one Jupiter swap; token accounts opened and
 * closed for the ghost wallet only; SOL leaves the ghost wallet only for its own wrapped SOL and
 * zSol's fee; the fee and the priority fee within what the browser expects. Returns zSol's fee.
 */
export function checkGhostSwap(
  transaction: Pick<Transaction, "messageBytes">,
  expect: {
    readonly ghost: Address;
    readonly cosigner: Address;
    /** Where zSol's fee may go. */
    readonly feeTo: ReadonlySet<Address>;
    /** The ghost wallet's own wrapped SOL account, which a swap of SOL funds. */
    readonly wrapped: Address;
    /** The most zSol's fee may be, in lamports. */
    readonly mostFee: bigint;
    readonly mostPriorityFee: bigint;
  },
): { readonly fee: bigint } {
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  if (message.version !== 1 || !("instructionHeaders" in message)) {
    return refuse("A ghost swap is a version 1 transaction.");
  }
  const keys: readonly string[] = message.staticAccounts;
  if (keys[0] !== expect.ghost) refuse("The ghost wallet pays its own swap.");
  const signers = keys.slice(0, message.header.numSignerAccounts);
  if (
    signers.length !== 2 ||
    !signers.includes(expect.ghost) ||
    !signers.includes(expect.cosigner)
  ) {
    refuse("Only the ghost wallet and zSol sign a ghost swap.");
  }
  const config: V1TransactionConfig =
    Reflect.get(decompileTransactionMessage(message), "config") ?? {};
  if ((config.priorityFeeLamports ?? 0n) > expect.mostPriorityFee) {
    refuse("The swap asks more priority fee than expected.");
  }
  let swaps = 0;
  let memos = 0;
  let fee = 0n;
  message.instructionHeaders.forEach((header, index) => {
    const program = keys[header.programAccountIndex];
    const payload = message.instructionPayloads[index];
    const named = (payload?.instructionAccountIndices ?? []).map((at: number) => keys[at]);
    const data = new Uint8Array(payload?.instructionData ?? []);
    if (program === MEMO_PROGRAM) {
      memos += 1;
      if (named.length !== 1 || named[0] !== expect.cosigner) {
        refuse("zSol signs only its own memo.");
      }
      return;
    }
    // zSol's fee may go to zSol's fee wallet itself: SOL into it, never out.
    if (program === SYSTEM_PROGRAM) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (data.length !== 12 || view.getUint32(0, true) !== SYSTEM_TRANSFER) {
        refuse("Only plain SOL transfers.");
      }
      const [from, to] = named;
      const amount = view.getBigUint64(4, true);
      if (from !== expect.ghost) refuse("Only the ghost wallet's own SOL moves.");
      if (to === expect.wrapped) return;
      if (to === undefined || !expect.feeTo.has(address(to))) {
        refuse("SOL leaves the ghost wallet only for its swap and zSol's fee.");
      }
      fee += amount;
      return;
    }
    if (named.includes(expect.cosigner)) refuse("The swap names zSol's fee wallet.");
    if (program === JUPITER_SWAP) {
      swaps += 1;
      return;
    }
    if (program === ASSOCIATED_TOKEN_PROGRAM) {
      const [payer, , owner] = named;
      if (
        data.length > 1 ||
        !ATA_CREATES.has(data[0] ?? 0) ||
        payer !== expect.ghost ||
        owner !== expect.ghost
      ) {
        refuse("Only the ghost wallet's own token accounts are opened.");
      }
      return;
    }
    if (program !== undefined && TOKEN_PROGRAMS.has(program)) {
      if (data[0] === TOKEN_SYNC_NATIVE) return;
      if (data[0] === TOKEN_CLOSE_ACCOUNT && named[1] === expect.ghost) return;
      refuse("Only wrapping SOL and closing the ghost wallet's accounts.");
      return;
    }
    refuse(`A ghost swap doesn't run ${String(program)}.`);
  });
  if (swaps !== 1) refuse("A ghost swap has one swap.");
  if (memos !== 1) refuse("A ghost swap carries zSol's signature once.");
  if (fee > expect.mostFee) refuse("zSol's fee is more than expected.");
  return { fee };
}
