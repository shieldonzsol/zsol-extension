// Move to private: what the zSol address holds in public, deposited into the private balance, so
// the address ends empty. An unregistered wallet registers itself first from that money. The
// address pays its own network fee, or hands back the one zSol's fee wallet fronts. A token the
// private pool can't take stays, and the rest still moves; what one transaction can't hold waits
// for the next move.
import { buildDepositTransaction, SOL_MINT, type ShieldedKeypair } from "@heliuslabs/spr";
import { getSplAssetRegistryAddress } from "@heliuslabs/spr/addresses";
import type { SprClient } from "@heliuslabs/spr/client";
import { getRegisterInstructionAsync } from "@heliuslabs/spr/instructions";
import { isWalletRegistered } from "@heliuslabs/spr/wallet";
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  decompileTransactionMessage,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  isSolanaError,
  isTransactionWithinSizeLimit,
  pipe,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  SOLANA_ERROR__TRANSACTION__EXCEEDS_SIZE_LIMIT,
  SOLANA_ERROR__TRANSACTION__TOO_MANY_ACCOUNT_ADDRESSES,
  SOLANA_ERROR__TRANSACTION__TOO_MANY_INSTRUCTIONS,
  type Address,
  type Instruction,
  type Transaction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { getCloseAccountInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import { networkFeeOf, SIGNATURE_FEE } from "./network-fee";
import {
  field,
  holdsMoney,
  publicMoneyOf,
  rawTokenOf,
  readAccounts,
  type PublicMoney,
  type PublicToken,
} from "./public-money";

export { holdsMoney, publicMoneyOf, rawTokenOf, type PublicMoney, type PublicToken };

/** A registry record's size: its rent is read for it. */
export const REGISTRY_RECORD_SPACE = 100n;
/** As zsol.cc sends it: within zSol's fee wallet's cap of 10,000. */
const PRIORITY_FEE = 10_000n;
const LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;
/** Solana's most compute units for one transaction. */
export const MAX_COMPUTE_UNITS = 1_400_000;
/** Solana's most accounts one transaction may name. */
const MAX_ACCOUNTS = 64;

/** Why a token stays at the address. */
export type StayReason =
  /** The private pool never held it: a first deposit must make its account there. */
  | "new-to-rings"
  | "frozen"
  /** Its deposit, or unwrapping it, fails in simulation. */
  | "fails"
  /** One transaction holds no more: the next move takes it. */
  | "later";

export interface StayingToken {
  readonly token: PublicToken;
  readonly why: StayReason;
}

/** The first move must register the wallet, and the address holds too little SOL to pay it. */
export class SweepShortOfRent extends Error {
  override readonly name = "SweepShortOfRent";
  constructor(
    /** The registry record's rent and the network fee, in lamports. */
    readonly rent: bigint,
    /** The SOL there, with what the accounts that close first bring. */
    readonly held: bigint,
  ) {
    super(`The address holds ${String(held)} lamports and needs ${String(rent)}.`);
  }
}

/** The SOL that would move is less than the network fee. */
export class SweepTooSmall extends Error {
  override readonly name = "SweepTooSmall";
  constructor(
    readonly fee: bigint,
    readonly held: bigint,
  ) {
    super(`The move's network fee is ${String(fee)} lamports; ${String(held)} would move.`);
  }
}

/** The move fails in simulation for a reason no token explains: nothing was signed. */
export class SweepWouldFail extends Error {
  override readonly name = "SweepWouldFail";
}

/** Who pays the network fee, and how much SOL moves through the address. */
export function sweepFlow(input: {
  readonly lamports: bigint;
  readonly reserve: bigint;
  readonly registryRent: bigint | null;
  /** The lamports of the token accounts the move closes. */
  readonly closed: bigint;
  /** The fee if the address pays it itself. */
  readonly selfFee: bigint;
}): { readonly flowing: bigint; readonly selfPaid: boolean } {
  const flowing = input.lamports - (input.registryRent ?? 0n) + input.closed;
  // It pays first when, the fee taken, it still holds its rent-exempt minimum.
  const selfPaid = input.lamports - input.selfFee >= input.reserve && flowing >= input.selfFee;
  return { flowing, selfPaid };
}

/**
 * What the fee takes, what is handed back to zSol, and the SOL that goes in. Less SOL than the
 * fee can't move: fronted, the fee couldn't be handed back; paid by the address, it would leave
 * the address short.
 */
export function sweepSplit(input: {
  readonly flowing: bigint;
  readonly selfPaid: boolean;
  readonly fee: bigint;
}): { readonly paysBack: bigint; readonly sol: bigint; readonly paid: bigint } {
  const { flowing, selfPaid, fee } = input;
  if (flowing > 0n && flowing < fee) throw new SweepTooSmall(fee, flowing);
  const paysBack = !selfPaid && flowing > 0n ? fee : 0n;
  const paid = selfPaid ? fee : paysBack;
  const sol = flowing - paid;
  return { paysBack, sol: sol > 0n ? sol : 0n, paid };
}

const instructionsOf = (transaction: Transaction): readonly Instruction[] =>
  decompileTransactionMessage(
    getCompiledTransactionMessageDecoder().decode(transaction.messageBytes),
  ).instructions;

/** The instruction a simulation failed at, if it names one. */
export function failedInstructionOf(err: unknown): number | null {
  const at: unknown = field(err, "InstructionError");
  if (!Array.isArray(at)) return null;
  const [index] = at as unknown[];
  if (typeof index === "number") return index;
  return typeof index === "bigint" ? Number(index) : null;
}

/** What kit refuses to compile into one transaction. */
const TOO_LARGE = [
  SOLANA_ERROR__TRANSACTION__TOO_MANY_ACCOUNT_ADDRESSES,
  SOLANA_ERROR__TRANSACTION__TOO_MANY_INSTRUCTIONS,
  SOLANA_ERROR__TRANSACTION__EXCEEDS_SIZE_LIMIT,
] as const;

/** Errors that say the transaction holds too much, not that one part of it is wrong. */
const TOO_MUCH: ReadonlySet<unknown> = new Set([
  "ComputationalBudgetExceeded",
  "MaxLoadedAccountsDataSizeExceeded",
  "TooManyAccountLocks",
]);

/** The simulation ran out of room: compute, or the accounts it may load or lock. */
export function overCapacity(err: unknown, unitsConsumed?: bigint): boolean {
  if (unitsConsumed !== undefined && unitsConsumed >= BigInt(MAX_COMPUTE_UNITS)) return true;
  if (TOO_MUCH.has(err)) return true;
  const at = field(err, "InstructionError");
  return Array.isArray(at) && TOO_MUCH.has((at as unknown[])[1]);
}

/** The compute a move asks for: what its simulation used, with room for a chain that moved on. */
export function sweepComputeLimit(unitsConsumed: bigint | undefined): number {
  if (unitsConsumed === undefined || unitsConsumed <= 0n) return MAX_COMPUTE_UNITS;
  return Math.min(MAX_COMPUTE_UNITS, Math.ceil(Number(unitsConsumed) * 1.2) + 20_000);
}

/** One token account's part in a move, in the order a full transaction would drop them. */
export interface SweepPart {
  readonly token: PublicToken;
  /** Wrapped SOL closed, a token deposited (its account closed after), an empty account closed. */
  readonly kind: "unwrap" | "deposit" | "empty";
}

/** Where each of a move's instructions came from: a token's deposit or closing, or the move's own. */
export type SweepOwner = { readonly token: PublicToken; readonly closes: boolean } | null;

/**
 * The parts a move that ran out of compute at instruction `at` leaves for the next one: every
 * part that hadn't finished by then, and the last deposit that had, for the SOL after it. Never
 * none, so each try takes less than the last.
 */
export function overflowOf(
  parts: readonly SweepPart[],
  owners: readonly SweepOwner[],
  at: number | null,
): SweepPart[] {
  const end = at ?? owners.length;
  const unfinished = new Set(
    owners.slice(end).flatMap((owner) => (owner ? [owner.token.account] : [])),
  );
  const finished = parts.filter((part) => !unfinished.has(part.token.account));
  const lastDeposit = finished.findLast((part) => part.kind === "deposit");
  const dropped = parts.filter(
    (part) => unfinished.has(part.token.account) || part === lastDeposit,
  );
  return dropped.length > 0 ? dropped : parts.slice(-1);
}

/**
 * Tokens with an amount whose deposit Rings can't take as they stand: frozen ones, and ones the
 * pool never held, whose interface a first deposit must make. A registry account someone sent
 * lamports to, with no data yet, is one the pool never held.
 */
export async function stayingOf(
  client: Pick<SprClient, "solanaRpc">,
  tokens: readonly PublicToken[],
): Promise<StayingToken[]> {
  const asked = tokens.filter((token) => token.amount > 0n);
  const frozen = asked.filter((token) => token.frozen);
  const open = asked.filter((token) => !token.frozen && !token.wrapped);
  const mints = [...new Set(open.map((token) => token.mint))];
  const known = new Set<Address>();
  if (mints.length > 0) {
    const registries = await Promise.all(mints.map((mint) => getSplAssetRegistryAddress(mint)));
    const read = await readAccounts(client, registries, { offset: 0, length: 8 });
    mints.forEach((mint, at) => {
      if ((read[at]?.length ?? 0) > 0) known.add(mint);
    });
  }
  return [
    ...frozen.map((token) => ({ token, why: "frozen" as const })),
    ...open
      .filter((token) => !known.has(token.mint))
      .map((token) => ({ token, why: "new-to-rings" as const })),
  ];
}

export interface Sweep {
  readonly transaction: Transaction;
  readonly money: PublicMoney;
  /** The registry record's rent this move pays, when it also registers the wallet. */
  readonly registryRent: bigint | null;
  /** The network fee the address pays, itself or handed back; zero when fronted. */
  readonly networkFee: bigint;
  /** The SOL that goes into the private balance, unwrapped SOL and closed accounts' rent too. */
  readonly sol: bigint;
  readonly moved: readonly PublicToken[];
  /** What it leaves at the address, each for its reason; empty accounts too. */
  readonly staying: readonly StayingToken[];
  /** Token accounts it closes, wrapped SOL's aside: their rent comes in as SOL. */
  readonly closes: number;
  /** That rent, in lamports. */
  readonly closedRent: bigint;
  /** Wrapped SOL it unwraps, in lamports, coming in with the SOL. */
  readonly unwrapped: bigint;
}

const rentOf = (tokens: readonly PublicToken[]) =>
  tokens.reduce((total, token) => total + token.rent, 0n);

/** Nothing can move: what is there stays, each for its reason. */
export interface NothingToMove {
  readonly nothing: true;
  readonly staying: readonly StayingToken[];
}

/**
 * Each token deposits from its own account. An account whose closing fails stays open, its token
 * still deposited; a token whose deposit fails stays, and the move is built again without it.
 * Closes that need no deposit run before a first move registers the wallet, so what they bring
 * can pay for the record. A move one transaction can't hold takes SOL first, then wrapped SOL,
 * tokens, and empty accounts, and leaves the rest for the next move. Throws `SweepShortOfRent`,
 * `SweepTooSmall` and `SweepWouldFail`, each before anything is signed.
 */
export async function buildSweep(
  client: SprClient,
  input: { readonly keypair: ShieldedKeypair; readonly feePayer: Address },
): Promise<Sweep | NothingToMove> {
  const shielded = input.keypair.shieldedAddress();
  const trader = shielded.solanaAddress();
  const [money, registered] = await Promise.all([
    publicMoneyOf(client, trader),
    isWalletRegistered({ rpc: client, owner: trader }),
  ]);
  const staying = await stayingOf(client, money.tokens);
  const nothing = (): NothingToMove => ({ nothing: true, staying });
  const self = createNoopSigner(trader);
  const selfFee = SIGNATURE_FEE + PRIORITY_FEE;
  let registryRent: bigint | null = null;
  let register: readonly Instruction[] = [];
  // Accounts whose closing failed in a simulation: left open, their token still deposited.
  const keepOpen = new Set<Address>();
  const legs = new Map<string, readonly Instruction[]>();
  const depositLegs = async (token: PublicToken, feePayer: Address) => {
    const key = `${feePayer}:${token.account}`;
    const known = legs.get(key);
    if (known) return known;
    const deposit = await buildDepositTransaction({
      client,
      feePayer,
      depositor: trader,
      recipient: shielded,
      asset: token.mint,
      amount: token.amount,
      splTokenAccount: token.account,
      createSplInterface: false,
      ...(token.program === TOKEN_PROGRAM_ADDRESS ? {} : { splTokenProgram: token.program }),
    });
    const built = instructionsOf(deposit);
    legs.set(key, built);
    return built;
  };
  const close = (token: PublicToken) =>
    getCloseAccountInstruction(
      { account: token.account, destination: trader, owner: self },
      { programAddress: token.program },
    );

  // Each try leaves out something the last one couldn't take: at most three times a token.
  const tries = 3 * money.tokens.length + 2;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const left = new Set(staying.map((each) => each.token.account));
    const takes = (token: PublicToken) => !token.frozen && !left.has(token.account);
    const parts: SweepPart[] = [
      ...money.tokens
        .filter((token) => token.wrapped && takes(token) && !keepOpen.has(token.account))
        .map((token) => ({ token, kind: "unwrap" as const })),
      ...money.tokens
        .filter((token) => !token.wrapped && token.amount > 0n && takes(token))
        .map((token) => ({ token, kind: "deposit" as const })),
      ...money.tokens
        .filter(
          (token) =>
            !token.wrapped && token.amount === 0n && takes(token) && !keepOpen.has(token.account),
        )
        .map((token) => ({ token, kind: "empty" as const })),
    ];
    if (money.lamports === 0n && parts.length === 0) return nothing();
    const early = parts.filter((part) => part.kind !== "deposit").map((part) => part.token);
    const depositing = parts.filter((part) => part.kind === "deposit").map((part) => part.token);
    const closesAfter = depositing.filter((token) => !keepOpen.has(token.account));

    if (!registered) {
      // oxlint-disable-next-line no-await-in-loop -- asked once, on the first try.
      registryRent ??= await client.solanaRpc
        .getMinimumBalanceForRentExemption(REGISTRY_RECORD_SPACE)
        .send();
      const needed = registryRent + SIGNATURE_FEE * 2n + PRIORITY_FEE;
      const held = money.lamports + rentOf(early);
      if (held < needed) throw new SweepShortOfRent(needed, held);
      if (register.length === 0) {
        register = [
          // oxlint-disable-next-line no-await-in-loop -- built once, on the first try.
          await getRegisterInstructionAsync({
            owner: self,
            payer: self,
            nullifierPublicKey: input.keypair.nullifierPublicKey(),
            viewingPublicKey: input.keypair.viewingPublicKey().toBytes(),
          }),
        ];
      }
    }
    const { flowing, selfPaid } = sweepFlow({
      lamports: money.lamports,
      reserve: money.reserve,
      registryRent,
      closed: rentOf(early) + rentOf(closesAfter),
      selfFee,
    });
    const feePayer = selfPaid ? trader : input.feePayer;
    const depositsOf = new Map<Address, readonly Instruction[]>();
    for (const token of depositing) {
      // oxlint-disable-next-line no-await-in-loop -- one deposit per token, in order.
      depositsOf.set(token.account, await depositLegs(token, feePayer));
    }

    const assemble = (kept: readonly SweepPart[]) => {
      const instructions: Instruction[] = [];
      const owners: SweepOwner[] = [];
      for (const part of kept) {
        if (part.kind === "deposit") continue;
        instructions.push(close(part.token));
        owners.push({ token: part.token, closes: true });
      }
      instructions.push(...register);
      owners.push(...register.map(() => null));
      for (const part of kept) {
        if (part.kind !== "deposit") continue;
        const deposit = depositsOf.get(part.token.account) ?? [];
        instructions.push(...deposit);
        owners.push(...deposit.map(() => ({ token: part.token, closes: false })));
        if (!keepOpen.has(part.token.account)) {
          instructions.push(close(part.token));
          owners.push({ token: part.token, closes: true });
        }
      }
      return { instructions, owners };
    };
    // oxlint-disable-next-line no-await-in-loop -- a fresh one each try.
    const { value: lifetime } = await client.solanaRpc.getLatestBlockhash().send();
    const rests = new Map<bigint, readonly Instruction[]>();
    const restFor = async (fee: bigint) => {
      const known = rests.get(fee);
      if (known) return known;
      const split = sweepSplit({ flowing, selfPaid, fee });
      // Fronted, the fee is handed back to zSol's fee wallet before the rest of the SOL goes in.
      const rest: Instruction[] =
        split.paysBack > 0n
          ? [
              getTransferSolInstruction({
                source: self,
                destination: input.feePayer,
                amount: split.paysBack,
              }),
            ]
          : [];
      if (split.sol > 0n) {
        const deposit = await buildDepositTransaction({
          client,
          feePayer,
          depositor: trader,
          recipient: shielded,
          asset: SOL_MINT,
          amount: split.sol,
        });
        rest.push(...instructionsOf(deposit));
      }
      rests.set(fee, rest);
      return rest;
    };
    const compile = (instructions: readonly Instruction[], computeUnitLimit: number) =>
      compileTransaction(
        pipe(
          createTransactionMessage({ version: 1 }),
          (message) => setTransactionMessageFeePayer(feePayer, message),
          (message) => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
          (message) =>
            setTransactionMessageConfig(
              {
                computeUnitLimit,
                loadedAccountsDataSizeLimit: LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
                priorityFeeLamports: PRIORITY_FEE,
              },
              message,
            ),
          (message) => appendTransactionMessageInstructions(instructions, message),
        ),
      );
    // Compiled only when one transaction can hold it.
    const fitting = (instructions: readonly Instruction[]): Transaction | null => {
      let transaction: Transaction;
      try {
        transaction = compile(instructions, MAX_COMPUTE_UNITS);
      } catch (error) {
        if (TOO_LARGE.some((code) => isSolanaError(error, code))) return null;
        throw error;
      }
      const accounts = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
        .staticAccounts.length;
      return isTransactionWithinSizeLimit(transaction) && accounts <= MAX_ACCOUNTS
        ? transaction
        : null;
    };
    const later = (dropped: readonly SweepPart[]) => {
      for (const part of dropped) staying.push({ token: part.token, why: "later" });
    };

    // Built on a guess, then again only when the chain prices it differently.
    const guess = selfPaid ? selfFee : SIGNATURE_FEE * 2n + PRIORITY_FEE;
    // A move deposits something, or zSol refuses it: closes alone hand back no fee.
    if (depositing.length === 0 && sweepSplit({ flowing, selfPaid, fee: guess }).sol === 0n) {
      return nothing();
    }
    // oxlint-disable-next-line no-await-in-loop -- each try depends on the last.
    const rest = await restFor(guess);
    const full = assemble(parts);
    const probe = fitting([...full.instructions, ...rest]);
    if (!probe) {
      if (parts.length === 0)
        throw new SweepWouldFail("Move to private doesn't fit one transaction.");
      // The most that fit, found without asking the chain: the SOL's size doesn't depend on its amount.
      let kept = parts.length - 1;
      while (kept > 0 && !fitting([...assemble(parts.slice(0, kept)).instructions, ...rest])) {
        kept -= 1;
      }
      later(parts.slice(kept));
      continue;
    }

    // oxlint-disable-next-line no-await-in-loop
    const { value: dryRun } = await client.solanaRpc
      .simulateTransaction(getBase64EncodedWireTransaction(probe), {
        encoding: "base64",
        commitment: "confirmed",
        sigVerify: false,
        replaceRecentBlockhash: true,
      })
      .send();
    if (dryRun.err) {
      if (overCapacity(dryRun.err, dryRun.unitsConsumed)) {
        if (parts.length === 0) {
          throw new SweepWouldFail("Move to private doesn't fit one transaction.");
        }
        later(overflowOf(parts, full.owners, failedInstructionOf(dryRun.err)));
        continue;
      }
      const at = failedInstructionOf(dryRun.err);
      const owner = at === null ? null : (full.owners[at] ?? null);
      if (!owner) {
        throw new SweepWouldFail(
          `Move to private fails in simulation: ${JSON.stringify(dryRun.err, (_, value: unknown) =>
            typeof value === "bigint" ? value.toString() : value,
          )}`,
        );
      }
      // An emptied account that won't close stays open; a deposit that fails, or wrapped SOL that
      // won't unwrap, keeps its money where it is.
      if (owner.closes && !(owner.token.wrapped && owner.token.amount > 0n)) {
        keepOpen.add(owner.token.account);
      } else {
        staying.push({ token: owner.token, why: "fails" });
      }
      continue;
    }

    const computeUnits = sweepComputeLimit(dryRun.unitsConsumed);
    const priced = compile([...full.instructions, ...rest], computeUnits);
    // oxlint-disable-next-line no-await-in-loop
    const fee = await networkFeeOf(client, priced);
    const transaction =
      fee === guess
        ? priced
        : // oxlint-disable-next-line no-await-in-loop
          compile([...full.instructions, ...(await restFor(fee))], computeUnits);
    const { paid, sol } = sweepSplit({ flowing, selfPaid, fee });
    const closedAccounts = [...early, ...closesAfter].filter((token) => !token.wrapped);
    return {
      transaction,
      money,
      registryRent,
      networkFee: paid,
      sol,
      moved: depositing,
      staying,
      closes: closedAccounts.length,
      closedRent: rentOf(closedAccounts),
      unwrapped: early
        .filter((token) => token.wrapped)
        .reduce((total, token) => total + token.amount, 0n),
    };
  }
  throw new SweepWouldFail("Move to private kept failing in simulation.");
}
