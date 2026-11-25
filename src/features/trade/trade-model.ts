// What a trade is, and a ghost wallet's swap prepared and checked: the parts the panel and the
// overlay share. Nothing here loads the private wallet.
import {
  getBase64Encoder,
  getTransactionDecoder,
  type Address,
  type Transaction,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import type { SponsorSetup } from "@/features/action/sponsor-setup";
import { readAmount, type AmountProblem } from "@/features/rings/amount-input";
import type { SprClient } from "@/features/rings/client";
import { checkGhostSwap, GhostSwapRefused } from "@/features/rings/ghost-swap";
import { publicMoneyOf } from "@/features/rings/public-money";
import { TradeError, WRAPPED_SOL_MINT } from "@/features/rings/trade";
import {
  ghostTradeFee,
  mostGhostFee,
  TRADE_FEE_TOLERANCE_BPS,
  tradeFee,
} from "@/features/rings/trade-fees";

import {
  buildGhostSwapOn,
  isSol,
  jupiterMint,
  PRIVATE_SOL,
  quoteTrade,
  TradeUnavailable,
  type TradeQuote,
  type TradeRefusal,
} from "./trade-api";

export interface TradePick {
  readonly mint: string;
  readonly symbol: string;
  readonly decimals: number;
}

export const SOL_PICK: TradePick = { mint: PRIVATE_SOL, symbol: "SOL", decimals: 9 };

export type TradeSource =
  | { readonly kind: "private" }
  | { readonly kind: "ghost"; readonly index: number; readonly address: Address };

export interface TradeDraft {
  readonly source: TradeSource;
  readonly from: TradePick;
  readonly to: TradePick | null;
  readonly amountText: string;
  readonly slippageBps: number;
}

export const SLIPPAGES = [50, 100, 200, 300] as const;

/** What a ghost wallet keeps after a buy: the token accounts it opens, and its fees. */
export const GHOST_KEEP_LAMPORTS = 5_000_000n;
/** What a ghost wallet needs for a sale: the wrapped-SOL account it opens and closes, and fees. */
export const GHOST_SELL_LAMPORTS = 2_200_000n;
/** The most priority fee a swap may ask; zSol's fee wallet allows no more. */
export const PRIORITY_FEE = 10_000n;
/** A classic token account's size: its rent, about, before the build measures it. */
export const TOKEN_ACCOUNT_BYTES = 165n;

export type TradeProblem =
  | { readonly kind: "no-token" }
  | { readonly kind: "same-token" }
  | { readonly kind: "amount"; readonly problem: AmountProblem }
  /** The private balance or the ghost wallet holds less of the input than this takes. */
  | {
      readonly kind: "short";
      readonly held: bigint;
      readonly amount: bigint;
      /** zSol's fee and a new token account's rent, on top when the input is SOL. */
      readonly fee: bigint;
      readonly rent: bigint;
      /** The most it can put in, with all that on top. */
      readonly most: bigint;
    }
  /** A trade with no SOL side pays zSol's fee and any rent from the private SOL, and it lacks. */
  | { readonly kind: "sol-for-fee"; readonly held: bigint; readonly needed: bigint }
  /** The ghost wallet's SOL can't pay for the swap and what it keeps. */
  | { readonly kind: "ghost-short"; readonly held: bigint; readonly needed: bigint }
  /** The private pool doesn't take the token bought, so it can't land in the private balance. */
  | { readonly kind: "not-private"; readonly symbol: string }
  | { readonly kind: "route"; readonly code: TradeRefusal; readonly retryAfter?: number }
  /** zSol's server built something other than what the panel asked; nothing was signed. */
  | { readonly kind: "changed" }
  /** The zSol address holds the input in public already: it moves to private first. */
  | { readonly kind: "public-input" }
  /** A sale brings less SOL than zSol's fee and the rent. */
  | { readonly kind: "too-small" };

export interface TradeFacts {
  readonly transaction: Transaction;
  readonly source: TradeSource;
  readonly from: TradePick;
  readonly to: TradePick;
  readonly amount: bigint;
  /** What the quote expects out, and the least the swap accepts. */
  readonly outQuoted: bigint;
  readonly minOut: bigint;
  /** zSol's fee, in lamports. */
  readonly fee: bigint;
  /** SOL for the new token accounts the trade opens, net of what comes back. */
  readonly rent: bigint;
  readonly priceImpactPercent: number | null;
  readonly route: readonly string[];
  readonly slippageBps: number;
}

/** The most SOL a ghost wallet can put into one buy: what it holds less its keep and the fee. */
export function ghostMaxBuy(lamports: bigint): bigint {
  const spendable = lamports - GHOST_KEEP_LAMPORTS;
  if (spendable <= 0n) return 0n;
  const most = (spendable * 10_000n) / 10_150n;
  return most > 0n ? most - 1n : 0n;
}

/** The most SOL a private trade can put in: what is held less zSol's 1% and `rent`. */
export function mostSolIn(held: bigint, rent: bigint, feeMinimum: bigint): bigint {
  const spendable = held - rent;
  if (spendable <= 0n) return 0n;
  let most = (spendable * 100n) / 101n;
  while (most > 0n && most + tradeFee(most, feeMinimum) > spendable) most -= 1n;
  if (most + tradeFee(most, feeMinimum) > spendable) return 0n;
  return most;
}

/** zSol's fee on a swap, in SOL: of its SOL side, or of its quoted worth. */
export function feeSideOf(
  input: { readonly from: string; readonly to: string; readonly amount: bigint },
  quote: Pick<TradeQuote, "outAmount" | "solValue">,
): bigint | null {
  if (isSol(input.from)) return input.amount;
  if (isSol(input.to)) return quote.outAmount;
  return quote.solValue;
}

export function draftProblem(draft: TradeDraft): TradeProblem | null {
  if (!draft.to) return { kind: "no-token" };
  if (jupiterMint(draft.from.mint) === jupiterMint(draft.to.mint)) return { kind: "same-token" };
  const read = readAmount(draft.amountText, draft.from.decimals);
  return read.ok ? null : { kind: "amount", problem: read.problem };
}

export const problemOfRefusal = (error: TradeUnavailable): TradeProblem => ({
  kind: "route",
  code: error.code,
  ...(error.retryAfterSeconds ? { retryAfter: Math.ceil(error.retryAfterSeconds) } : {}),
});

export function problemOfTradeError(error: TradeError): TradeProblem {
  switch (error.code) {
    case "nothing-to-withdraw":
      return { kind: "public-input" };
    case "too-small":
      return { kind: "too-small" };
    case "no-sol-value":
      return { kind: "route", code: "no-value" };
    case "same-token":
      return { kind: "same-token" };
    default:
      return { kind: "route", code: "no-route" };
  }
}

/** The swap's least output, checked against the quote: zSol's server may not ask for less. */
export function leastAccepted(quoted: bigint, slippageBps: number): bigint {
  const room = BigInt(slippageBps) + TRADE_FEE_TOLERANCE_BPS;
  return room >= 10_000n ? 0n : (quoted * (10_000n - room)) / 10_000n;
}

export async function prepareGhostSwap(
  draft: TradeDraft & { readonly to: TradePick },
  ghost: Extract<TradeSource, { kind: "ghost" }>,
  amount: bigint,
  context: {
    readonly open: { readonly site: string; readonly client: Pick<SprClient, "solanaRpc"> };
    readonly fees: Pick<SponsorSetup, "feePayer" | "treasury">;
  },
): Promise<{ readonly problem: TradeProblem } | { readonly review: TradeFacts }> {
  const { open, fees } = context;
  const [money, quote] = await Promise.all([
    publicMoneyOf(open.client, ghost.address),
    quoteTrade(open.site, { from: draft.from.mint, to: draft.to.mint, amount }),
  ]);
  const side = feeSideOf({ from: draft.from.mint, to: draft.to.mint, amount }, quote);
  if (side === null) return { problem: { kind: "route", code: "no-value" } };
  const fee = ghostTradeFee(side);
  const selling = !isSol(draft.from.mint);
  const account = selling
    ? money.tokens.find((token) => token.mint === draft.from.mint && token.amount > 0n)
    : undefined;
  if (selling) {
    const held = account?.amount ?? 0n;
    if (held < amount) {
      return { problem: { kind: "short", held, amount, fee: 0n, rent: 0n, most: held } };
    }
    if (money.lamports < GHOST_SELL_LAMPORTS) {
      return {
        problem: { kind: "ghost-short", held: money.lamports, needed: GHOST_SELL_LAMPORTS },
      };
    }
  } else {
    const needed = amount + fee + GHOST_KEEP_LAMPORTS;
    if (money.lamports < needed) {
      return { problem: { kind: "ghost-short", held: money.lamports, needed } };
    }
  }
  // Selling all of a classic token closes its emptied account, and its rent comes back.
  const closes =
    account && account.amount === amount && account.program === TOKEN_PROGRAM_ADDRESS
      ? account.account
      : undefined;
  const built = await buildGhostSwapOn(open.site, {
    from: draft.from.mint,
    to: draft.to.mint,
    amount,
    ghost: ghost.address,
    slippageBps: draft.slippageBps,
    ...(closes ? { closes } : {}),
  });
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(built.transaction));
  const [wrapped] = await findAssociatedTokenPda({
    owner: ghost.address,
    mint: WRAPPED_SOL_MINT,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const checked = checkGhostSwap(transaction, {
    ghost: ghost.address,
    cosigner: fees.feePayer,
    feeTo: new Set([fees.treasury, fees.feePayer]),
    wrapped,
    mostFee: mostGhostFee(fee),
    mostPriorityFee: PRIORITY_FEE,
  });
  if (
    built.inAmount !== amount ||
    built.minOutAmount < leastAccepted(quote.outAmount, draft.slippageBps)
  ) {
    throw new GhostSwapRefused("The swap zSol built isn't the one asked for.");
  }
  return {
    review: {
      transaction,
      source: draft.source,
      from: draft.from,
      to: draft.to,
      amount,
      outQuoted: built.outAmount,
      minOut: built.minOutAmount,
      fee: checked.fee,
      rent: 0n,
      priceImpactPercent: quote.priceImpactPercent,
      route: quote.route,
      slippageBps: draft.slippageBps,
    },
  };
}
