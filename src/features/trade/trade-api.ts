// zSol's trade route, as the panel asks it: token search, a quote, a route built for the private
// wallet's own address, and a ghost wallet's swap built whole. Every answer is checked before
// anything reads it.
import { address, getBase64Encoder, isAddress, type Address } from "@solana/kit";

import { siteFetch } from "@/features/rings/client";
import type { AggregatorBuild, SwapInstruction } from "@/features/rings/trade";

export const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
/** SOL as a private balance names it. */
export const PRIVATE_SOL = "11111111111111111111111111111111";

/** Jupiter's name for a private balance's token. */
export const jupiterMint = (mint: string) => (mint === PRIVATE_SOL ? WRAPPED_SOL : mint);
export const isSol = (mint: string) => jupiterMint(mint) === WRAPPED_SOL;

/** Why zSol's trade route said no, as it names it, or what the panel saw. */
export const TRADE_REFUSALS = [
  "no-route",
  "busy",
  "unreachable",
  "bad-token",
  "amount-too-small",
  "amount-too-large",
  "no-value",
  "signed-out",
  "same-token",
  "update",
  "failed",
] as const;

export type TradeRefusal = (typeof TRADE_REFUSALS)[number];

export class TradeUnavailable extends Error {
  override readonly name = "TradeUnavailable";
  constructor(
    readonly code: TradeRefusal,
    readonly retryAfterSeconds?: number,
  ) {
    super(`The trade is unavailable: ${code}`);
  }
}

const isRefusal = (code: unknown): code is TradeRefusal =>
  typeof code === "string" && (TRADE_REFUSALS as readonly string[]).includes(code);

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

const AMOUNT = /^\d{1,30}$/;

function amountIn(value: unknown, name: string): bigint {
  const text = field(value, name);
  if (typeof text !== "string" || !AMOUNT.test(text)) throw new TradeUnavailable("failed");
  return BigInt(text);
}

function addressIn(value: unknown, name: string): Address {
  const text = field(value, name);
  if (typeof text !== "string" || !isAddress(text)) throw new TradeUnavailable("failed");
  return address(text);
}

/** Asks zSol's trade route; its refusals come back as `TradeUnavailable`. */
async function ask(site: string, body: Record<string, unknown>): Promise<unknown> {
  let response: Response;
  try {
    response = await siteFetch(site)(`${site}/api/trade`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new TradeUnavailable("unreachable");
  }
  const answer: unknown = await response.json().catch(() => null);
  if (response.ok) return answer;
  const code = field(answer, "error");
  const wait = field(answer, "retryAfterSeconds");
  throw new TradeUnavailable(
    isRefusal(code)
      ? code
      : response.status === 426
        ? "update"
        : response.status === 401
          ? "signed-out"
          : response.status === 429
            ? "busy"
            : response.status >= 500
              ? "unreachable"
              : "failed",
    typeof wait === "number" && wait > 0 ? wait : undefined,
  );
}

export interface TradeToken {
  readonly mint: string;
  readonly symbol: string;
  readonly name: string | null;
  readonly decimals: number;
  readonly verified: boolean;
}

export async function searchTokens(site: string, query: string): Promise<TradeToken[]> {
  const answer = await ask(site, { action: "tokens", query: query.slice(0, 64) });
  const tokens = field(answer, "tokens");
  if (!Array.isArray(tokens)) return [];
  return tokens.flatMap((token: unknown): TradeToken[] => {
    const mint = field(token, "mint");
    const decimals = field(token, "decimals");
    if (typeof mint !== "string" || !isAddress(mint)) return [];
    if (
      typeof decimals !== "number" ||
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 18
    ) {
      return [];
    }
    const symbol = field(token, "symbol");
    const name = field(token, "name");
    return [
      {
        mint,
        symbol:
          typeof symbol === "string" && symbol.trim() !== ""
            ? symbol.trim().slice(0, 16)
            : `${mint.slice(0, 4)}…`,
        name: typeof name === "string" ? name.slice(0, 64) : null,
        decimals,
        verified: field(token, "verified") === true,
      },
    ];
  });
}

export interface TradeQuote {
  readonly outAmount: bigint;
  readonly priceImpactPercent: number | null;
  readonly route: readonly string[];
  /** What the input is worth in SOL, for a trade with no SOL side. */
  readonly solValue: bigint | null;
  /** When Jupiter gave it, on this panel's clock. */
  readonly quotedAt: number;
}

export async function quoteTrade(
  site: string,
  input: { readonly from: string; readonly to: string; readonly amount: bigint },
): Promise<TradeQuote> {
  const answer = await ask(site, {
    action: "quote",
    inputMint: jupiterMint(input.from),
    outputMint: jupiterMint(input.to),
    amount: input.amount.toString(),
  });
  const impact = field(answer, "priceImpactPercent");
  const route = field(answer, "route");
  const solValue = field(answer, "solValue");
  const quotedAt = field(answer, "quotedAt");
  const servedAt = field(answer, "servedAt");
  const now = Date.now();
  return {
    outAmount: amountIn(answer, "outAmount"),
    priceImpactPercent: typeof impact === "number" && Number.isFinite(impact) ? impact : null,
    route: Array.isArray(route)
      ? route.filter((step): step is string => typeof step === "string").slice(0, 8)
      : [],
    solValue: typeof solValue === "string" && AMOUNT.test(solValue) ? BigInt(solValue) : null,
    // Its age by zSol's own clock, counted back from this panel's.
    quotedAt:
      typeof quotedAt === "number" && typeof servedAt === "number"
        ? now - Math.max(0, servedAt - quotedAt)
        : now,
  };
}

function instructionIn(value: unknown): SwapInstruction {
  const program = field(value, "programAddress");
  const accounts = field(value, "accounts");
  const data = field(value, "data");
  if (typeof program !== "string" || !isAddress(program) || !Array.isArray(accounts)) {
    throw new TradeUnavailable("failed");
  }
  if (typeof data !== "string") throw new TradeUnavailable("failed");
  return {
    programAddress: program,
    accounts: accounts.map((account: unknown) => {
      const at = field(account, "address");
      if (typeof at !== "string" || !isAddress(at)) throw new TradeUnavailable("failed");
      return {
        address: at,
        signer: field(account, "signer") === true,
        writable: field(account, "writable") === true,
      };
    }),
    data: new Uint8Array(getBase64Encoder().encode(data)),
  };
}

/** Jupiter's route for the private wallet's own address, zSol's fee wallet as its payer. */
export async function routeFor(
  site: string,
  input: {
    readonly inputMint: Address;
    readonly outputMint: Address;
    readonly amount: bigint;
    readonly trader: Address;
    readonly maxAccounts: number;
    readonly excludeDexes: readonly string[];
    readonly slippageBps: number;
  },
): Promise<AggregatorBuild> {
  const answer = await ask(site, {
    action: "route",
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount.toString(),
    trader: input.trader,
    maxAccounts: input.maxAccounts,
    excludeDexes: [...input.excludeDexes],
    slippageBps: input.slippageBps,
  });
  const setup = field(answer, "setup");
  const other = field(answer, "other");
  const cleanup = field(answer, "cleanup");
  return {
    inAmount: amountIn(answer, "inAmount"),
    minOutAmount: amountIn(answer, "minOutAmount"),
    setup: Array.isArray(setup) ? setup.map(instructionIn) : [],
    swap: instructionIn(field(answer, "swap")),
    cleanup: cleanup === null || cleanup === undefined ? null : instructionIn(cleanup),
    other: Array.isArray(other) ? other.map(instructionIn) : [],
  };
}

/** The venue labels Jupiter gives its programs: which one to leave out of a route. */
export async function venueLabels(site: string): Promise<ReadonlyMap<string, string>> {
  const labels = field(await ask(site, { action: "labels" }), "labels");
  return new Map(
    Array.isArray(labels)
      ? labels.flatMap((pair: unknown): [string, string][] =>
          Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string"
            ? [[pair[0], pair[1]]]
            : [],
        )
      : [],
  );
}

export interface GhostSwapBuilt {
  /** Base64, co-signed by zSol's fee wallet. */
  readonly transaction: string;
  readonly fee: bigint;
  readonly feeTo: Address;
  readonly inAmount: bigint;
  readonly outAmount: bigint;
  readonly minOutAmount: bigint;
}

/** A ghost wallet's swap, built whole by zSol's server and co-signed by its fee wallet. */
export async function buildGhostSwapOn(
  site: string,
  input: {
    readonly from: string;
    readonly to: string;
    readonly amount: bigint;
    readonly ghost: Address;
    readonly slippageBps: number;
    /** Selling all of a classic token: the ghost wallet's emptied account, closed in the swap. */
    readonly closes?: Address;
  },
): Promise<GhostSwapBuilt> {
  const answer = await ask(site, {
    action: "ghost-swap",
    inputMint: jupiterMint(input.from),
    outputMint: jupiterMint(input.to),
    amount: input.amount.toString(),
    ghost: input.ghost,
    maxAccounts: 40,
    excludeDexes: [],
    slippageBps: input.slippageBps,
    ...(input.closes ? { closes: input.closes } : {}),
  });
  const transaction = field(answer, "transaction");
  if (typeof transaction !== "string" || transaction.length > 8_000) {
    throw new TradeUnavailable("failed");
  }
  return {
    transaction,
    fee: amountIn(answer, "fee"),
    feeTo: addressIn(answer, "feeTo"),
    inAmount: amountIn(answer, "inAmount"),
    outAmount: amountIn(answer, "outAmount"),
    minOutAmount: amountIn(answer, "minOutAmount"),
  };
}
