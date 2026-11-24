// A trade from the private balance, the pure half: one version 1 transaction withdraws the input
// to the private wallet's own address, swaps it there with Jupiter's instructions, and deposits
// the output back. zSol's 1% is in SOL, of the trade's SOL side or its quoted worth, and the
// trader hands back the rent zSol's fee wallet fronts for the accounts the swap opens.
import {
  AccountRole,
  address,
  type AccountMeta,
  type Address,
  type Instruction,
} from "@solana/kit";

import { tradeFee } from "./trade-fees";

/** An aggregator's instruction as its API answers it (Jupiter's `/build`). */
export interface SwapInstruction {
  readonly programAddress: string;
  readonly accounts: readonly {
    readonly address: string;
    readonly signer: boolean;
    readonly writable: boolean;
  }[];
  readonly data: Uint8Array;
}

/** A swap quoted and built for the trader: exactly `inAmount` in, at least `minOutAmount` out. */
export interface TradeSwap {
  /** SOL is wrapped SOL's mint, as aggregators name it. */
  readonly inputMint: Address;
  readonly outputMint: Address;
  readonly inAmount: bigint;
  readonly minOutAmount: bigint;
  /** Setup, swap and cleanup, in order. No compute budget: a v1 transaction sets its own. */
  readonly instructions: readonly SwapInstruction[];
}

export type TradeErrorCode =
  | "same-token"
  | "no-sol-value"
  | "foreign-signer"
  | "fee-payer-spend"
  | "compute-budget"
  | "nothing-to-withdraw"
  | "too-small"
  | "too-large";

export class TradeError extends Error {
  override readonly name = "TradeError";
  constructor(
    readonly code: TradeErrorCode,
    message: string,
    /** The swap's program that broke the check: ask the aggregator again without its venue. */
    readonly program?: string,
  ) {
    super(message);
  }
}

/** A version 1 transaction's limits. */
export const TRADE_MAX_BYTES = 4_096;
export const TRADE_MAX_ACCOUNTS = 64;
/**
 * How many accounts to let the aggregator's route use, largest first: a trade asks again with
 * the next when its transaction comes out too large.
 */
export const ROUTE_ACCOUNTS = [28, 22, 16] as const;

/** How many venues a trade leaves out before it gives up on a route. */
export const MAX_EXCLUDED_VENUES = 3;

/**
 * The venue inside a swap that names zSol's fee wallet (a venue taking Jupiter's `payer` inside the
 * swap, as Manifest does): the nearest account before it that is a venue's program, by the
 * aggregator's labels. Null when no instruction names it, or no label is found.
 */
export function venueNamingFeePayer(
  swap: TradeSwap,
  feePayer: Address,
  labels: ReadonlyMap<string, string>,
): string | null {
  for (const instruction of swap.instructions) {
    const at = instruction.accounts.findIndex((account) => account.address === feePayer);
    if (at < 0 || instruction.programAddress === ASSOCIATED_TOKEN_PROGRAM) continue;
    for (let back = at - 1; back >= 0; back -= 1) {
      const label = labels.get(instruction.accounts[back]!.address);
      if (label) return label;
    }
  }
  return null;
}

/** What a trade asks the aggregator for, each time it asks. */
export interface RouteAsk {
  readonly maxAccounts: number;
  /** Venues left out: their swaps named zSol's fee wallet. */
  readonly excludeDexes: readonly string[];
}

/**
 * A trade's route found and built: the aggregator asked with the most route accounts first and
 * fewer while the transaction comes out too large (`ROUTE_ACCOUNTS`), and without a venue whose
 * swap names zSol's fee wallet. `build` runs every other check, and its refusals stand.
 */
export async function routeTrade<Built>(input: {
  readonly ask: (ask: RouteAsk) => Promise<TradeSwap>;
  readonly build: (swap: TradeSwap) => Promise<Built>;
  readonly feePayer: Address;
  /** The aggregator's venue labels by program, read once when first needed. */
  readonly labels: () => Promise<ReadonlyMap<string, string>>;
}): Promise<Built> {
  const excluded: string[] = [];
  let sizes = 0;
  for (;;) {
    const maxAccounts = ROUTE_ACCOUNTS[sizes];
    if (maxAccounts === undefined) {
      throw new TradeError("too-large", "No route small enough for one transaction.");
    }
    // oxlint-disable-next-line no-await-in-loop -- each ask depends on the last one's refusal.
    const swap = await input.ask({ maxAccounts, excludeDexes: excluded });
    try {
      // oxlint-disable-next-line no-await-in-loop
      return await input.build(swap);
    } catch (error) {
      if (!(error instanceof TradeError)) throw error;
      if (error.code === "too-large") {
        sizes += 1;
        continue;
      }
      if (error.code !== "fee-payer-spend" || excluded.length >= MAX_EXCLUDED_VENUES) {
        throw error;
      }
      // oxlint-disable-next-line no-await-in-loop
      const venue = venueNamingFeePayer(swap, input.feePayer, await input.labels());
      if (!venue || excluded.includes(venue)) throw error;
      excluded.push(venue);
    }
  }
}

/** Jupiter's build as zSol's trade route answers it, in the parts a trade uses. */
export interface AggregatorBuild {
  readonly inAmount: bigint;
  readonly minOutAmount: bigint;
  readonly setup: readonly SwapInstruction[];
  readonly swap: SwapInstruction;
  readonly cleanup: SwapInstruction | null;
  readonly other: readonly SwapInstruction[];
}

/** The swap a trade carries, from an aggregator's build for the trader. */
export function tradeSwapOf(
  inputMint: Address,
  outputMint: Address,
  build: AggregatorBuild,
): TradeSwap {
  return {
    inputMint,
    outputMint,
    inAmount: build.inAmount,
    minOutAmount: build.minOutAmount,
    instructions: [
      ...build.setup,
      build.swap,
      ...(build.cleanup ? [build.cleanup] : []),
      ...build.other,
    ],
  };
}

export const WRAPPED_SOL_MINT = address("So11111111111111111111111111111111111111112");

export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
/** Associated Token Account `Create` (no data or 0) and `CreateIdempotent` (1). */
const ATA_CREATES = new Set([0, 1]);

export interface TradeParties {
  /** The private wallet's own Solana address: it signs the withdrawal and the swap. */
  readonly trader: Address;
  /** zSol's fee wallet: pays the fee and the rent of the trader's token accounts. */
  readonly feePayer: Address;
}

/**
 * The swap's instructions, refused before anything is built if they ask anyone but the trader
 * and zSol's fee wallet to sign, or name zSol's fee wallet anywhere but as the payer creating one of
 * the trader's token accounts (it fronts that rent and nothing else). zSol's fee wallet signs the
 * whole transaction, so any instruction naming it could spend from it.
 */
export function checkedSwap(swap: TradeSwap, parties: TradeParties): void {
  if (swap.inputMint === swap.outputMint) {
    throw new TradeError("same-token", "A trade needs two different tokens.");
  }
  for (const instruction of swap.instructions) {
    if (instruction.programAddress === COMPUTE_BUDGET_PROGRAM) {
      throw new TradeError(
        "compute-budget",
        "A version 1 transaction sets its compute budget itself.",
      );
    }
    for (const account of instruction.accounts) {
      if (!account.signer) continue;
      if (account.address !== parties.trader && account.address !== parties.feePayer) {
        throw new TradeError(
          "foreign-signer",
          `The swap asks ${account.address} to sign.`,
          instruction.programAddress,
        );
      }
    }
    const namesFeePayer = instruction.accounts.some(
      (account) => account.address === parties.feePayer,
    );
    if (!namesFeePayer) continue;
    const [payer, , owner] = instruction.accounts;
    const createsTraderAccount =
      instruction.programAddress === ASSOCIATED_TOKEN_PROGRAM &&
      instruction.data.length <= 1 &&
      ATA_CREATES.has(instruction.data[0] ?? 0) &&
      payer?.address === parties.feePayer &&
      owner?.address === parties.trader;
    if (!createsTraderAccount) {
      throw new TradeError(
        "fee-payer-spend",
        `The swap names zSol's fee wallet in ${instruction.programAddress}.`,
        instruction.programAddress,
      );
    }
  }
}

/**
 * The SOL a trade's fee is counted on when one side is SOL: what goes in, or the least that
 * comes out. Null for a trade with no SOL side, which a quote prices instead.
 */
export function solSideOf(swap: TradeSwap): bigint | null {
  if (swap.inputMint === WRAPPED_SOL_MINT) return swap.inAmount;
  if (swap.outputMint === WRAPPED_SOL_MINT) return swap.minOutAmount;
  return null;
}

/** What a trade costs the trader in SOL besides the swap itself. */
export interface TradeCosts {
  /** zSol's 1%. */
  readonly fee: bigint;
  /** Rent zSol's fee wallet fronts for the accounts the swap opens: all handed back. */
  readonly rentFronted: bigint;
  /** Of that rent, what the swap's own clean-up returns to the trader (wrapped SOL closed). */
  readonly rentRefunded: bigint;
}

/**
 * zSol's fee for a swap, from its SOL side, or from `solValue` (a quote) when it has none, never
 * under `minimum`.
 */
export function tradeCosts(
  swap: TradeSwap,
  rent: { readonly fronted: bigint; readonly refunded: bigint },
  solValue?: bigint,
  minimum = 0n,
): TradeCosts {
  const side = solSideOf(swap) ?? solValue;
  if (side === undefined) {
    throw new TradeError(
      "no-sol-value",
      "A trade with no SOL side needs its SOL value from a quote.",
    );
  }
  return {
    fee: tradeFee(side, minimum),
    rentFronted: rent.fronted,
    rentRefunded: rent.refunded,
  };
}

/**
 * The swap's instructions that have zSol's fee wallet open one of the trader's token accounts
 * (Jupiter's setup with zSol's fee wallet as `payer`), and each account they open.
 */
export function accountsOpened(
  swap: TradeSwap,
  feePayer: Address,
): {
  readonly instructions: readonly SwapInstruction[];
  readonly accounts: readonly Address[];
} {
  const instructions = swap.instructions.filter(
    (instruction) =>
      instruction.programAddress === ASSOCIATED_TOKEN_PROGRAM &&
      instruction.data.length <= 1 &&
      ATA_CREATES.has(instruction.data[0] ?? 0) &&
      instruction.accounts[0]?.address === feePayer &&
      instruction.accounts[0].signer,
  );
  return {
    instructions,
    accounts: instructions.map((instruction) => address(instruction.accounts[1]!.address)),
  };
}

/** What the trader holds in public before the trade. */
export interface TraderBalances {
  readonly lamports: bigint;
  /** Its token account for the input (zero when it has none; unused for SOL). */
  readonly inputTokens: bigint;
  /** Its token account for the output (zero when it has none; unused for SOL). */
  readonly outputTokens: bigint;
  /** The rent-exempt minimum of a system account, from the chain (650,240 lamports on mainnet, 2026-11-12). */
  readonly reserve: bigint;
}

export interface TradeAmounts extends TradeCosts {
  /** Taken from the private balance to the trader, in the swap's input. */
  readonly withdraw: bigint;
  /**
   * SOL also taken from the private balance for zSol's fee and the rent, when the swap has no SOL
   * side to pay them from; zero otherwise.
   */
  readonly withdrawSol: bigint;
  /** Put back into the private balance from the trader, after the swap, in its output. */
  readonly deposit: bigint;
}

/**
 * How much to withdraw and deposit. The trader's SOL cost is zSol's fee and the rent of the
 * accounts the swap leaves open (fronted, less what its clean-up refunds). The withdrawal tops
 * up what the trader already holds of the input to the swap's `inAmount`, plus that cost when
 * the input is SOL. The deposit is the swap's minimum plus what the trader already held of the
 * output, less that cost when the output is SOL, and in SOL less what keeps the trader at its
 * rent reserve (a system account may end a transaction empty or above that reserve, never in
 * between, and the swap may pay more than its minimum). With no SOL side, the cost comes from
 * a SOL withdrawal of its own, less the trader's spare SOL.
 */
export function tradeAmounts(
  swap: TradeSwap,
  held: TraderBalances,
  costs: TradeCosts,
): TradeAmounts {
  const inputIsSol = swap.inputMint === WRAPPED_SOL_MINT;
  const outputIsSol = swap.outputMint === WRAPPED_SOL_MINT;
  const spareLamports = held.lamports > held.reserve ? held.lamports - held.reserve : 0n;
  const solCost = costs.fee + costs.rentFronted - costs.rentRefunded;
  const withdraw = inputIsSol
    ? swap.inAmount + solCost - spareLamports
    : swap.inAmount - held.inputTokens;
  if (withdraw <= 0n) {
    throw new TradeError(
      "nothing-to-withdraw",
      "The trader already holds the swap's input in public.",
    );
  }
  const deposit = outputIsSol
    ? held.lamports + swap.minOutAmount - solCost - held.reserve
    : held.outputTokens + swap.minOutAmount;
  if (deposit <= 0n) {
    throw new TradeError(
      "too-small",
      "The swap pays less SOL than zSol's fee, the rent and the trader's rent reserve.",
    );
  }
  const solShort = solCost - spareLamports;
  const withdrawSol = inputIsSol || outputIsSol || solShort <= 0n ? 0n : solShort;
  return { ...costs, withdraw, withdrawSol, deposit };
}

/** The swap's instructions for Kit. Signers are left to the compiled transaction's signing. */
export function swapInstructionsForKit(swap: TradeSwap): Instruction[] {
  return swap.instructions.map((instruction) => ({
    programAddress: address(instruction.programAddress),
    accounts: instruction.accounts.map((account): AccountMeta => ({
      address: address(account.address),
      role: account.signer
        ? account.writable
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.READONLY_SIGNER
        : account.writable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY,
    })),
    data: instruction.data,
  }));
}
