// Trade from the panel: any pair Jupiter routes, from the private balance (zSol's 1%, the swap at
// the private wallet's own address, the output back into the private balance) or from a ghost
// wallet (zSol's 1.5%, a swap zSol's server builds whole and the panel checks before the ghost
// key signs).
import {
  address,
  getBase64Encoder,
  getTransactionDecoder,
  type Address,
  type Transaction,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import {
  createAction,
  type ActionContext,
  type ActionState,
  type Built,
  type Paused,
} from "@/features/action/engine";
import { submitSponsored, type SponsorSetup } from "@/features/action/sponsor";
import { readAmount, type AmountProblem } from "@/features/rings/amount-input";
import { formatAmount } from "@/features/rings/amounts";
import { checkGhostSwap, GhostSwapRefused } from "@/features/rings/ghost-swap";
import { heldIn } from "@/features/rings/holdings";
import { publicMoneyOf } from "@/features/rings/sweep";
import { tokenInfo } from "@/features/rings/token-info";
import { routeTrade, TradeError, tradeSwapOf, WRAPPED_SOL_MINT } from "@/features/rings/trade";
import { buildTradeTransaction } from "@/features/rings/trade-build";
import {
  ghostTradeFee,
  mostGhostFee,
  TRADE_FEE_TOLERANCE_BPS,
  tradeFee,
} from "@/features/rings/trade-fees";
import { tokenProgramOf } from "@/features/rings/unshield";
import type { SprClient } from "@/features/rings/client";
import {
  ghostKeys,
  inWalletLane,
  readAgain,
  readBack,
  spending,
} from "@/features/wallet/wallet-store";

import { sendFromGhost } from "./ghost-send";
import {
  buildGhostSwapOn,
  isSol,
  jupiterMint,
  PRIVATE_SOL,
  quoteTrade,
  routeFor,
  TradeUnavailable,
  venueLabels,
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
const PRIORITY_FEE = 10_000n;
/** A classic token account's size: its rent, about, before the build measures it. */
const TOKEN_ACCOUNT_BYTES = 165n;

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

export type FormProblem = TradeProblem | Paused;

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

export type Review = Built<TradeFacts>;
type Context = ActionContext & { readonly fees: SponsorSetup };
export type TradeState = ActionState<TradeProblem, TradeFacts>;

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

const problemOfRefusal = (error: TradeUnavailable): TradeProblem => ({
  kind: "route",
  code: error.code,
  ...(error.retryAfterSeconds ? { retryAfter: Math.ceil(error.retryAfterSeconds) } : {}),
});

function problemOfTradeError(error: TradeError): TradeProblem {
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

/**
 * The rent of the private wallet's own account for a token bought, when it has none yet: the
 * trade opens it and the private SOL pays it back. Zero when it exists.
 */
async function newAccountRent(client: SprClient, owner: Address, mint: Address): Promise<bigint> {
  const tokenProgram = await tokenProgramOf(client, mint);
  const [account] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
  const { value } = await client.solanaRpc
    .getAccountInfo(account, {
      encoding: "base64",
      commitment: "confirmed",
      dataSlice: { offset: 0, length: 0 },
    })
    .send();
  return value
    ? 0n
    : client.solanaRpc.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_BYTES).send();
}

/** The swap's least output, checked against the quote: zSol's server may not ask for less. */
function leastAccepted(quoted: bigint, slippageBps: number): bigint {
  const room = BigInt(slippageBps) + TRADE_FEE_TOLERANCE_BPS;
  return room >= 10_000n ? 0n : (quoted * (10_000n - room)) / 10_000n;
}

async function preparePrivate(
  draft: TradeDraft & { readonly to: TradePick },
  amount: bigint,
  context: Context,
): Promise<{ readonly problem: TradeProblem } | { readonly review: TradeFacts }> {
  const { open, fees } = context;
  const held = heldIn(open.spender.wallet, draft.from.mint);
  const fromSol = isSol(draft.from.mint);
  if (!fromSol && held < amount) {
    return { problem: { kind: "short", held, amount, fee: 0n, rent: 0n, most: held } };
  }
  const buysToken = !isSol(draft.to.mint);
  const trader = open.spender.keypair.shieldedAddress().solanaAddress();
  const [quote, card, rent] = await Promise.all([
    quoteTrade(open.site, { from: draft.from.mint, to: draft.to.mint, amount }),
    buysToken ? tokenInfo(open.site, open.client, draft.to.mint).catch(() => null) : null,
    buysToken ? newAccountRent(open.client, trader, address(draft.to.mint)) : 0n,
  ]);
  if (card?.refused) return { problem: { kind: "not-private", symbol: draft.to.symbol } };
  const side = feeSideOf({ from: draft.from.mint, to: draft.to.mint, amount }, quote);
  if (side === null) return { problem: { kind: "route", code: "no-value" } };
  const fee = tradeFee(side, fees.tradeFeeMinimum);
  if (fromSol && held < amount + fee + rent) {
    return {
      problem: {
        kind: "short",
        held,
        amount,
        fee,
        rent,
        most: mostSolIn(held, rent, fees.tradeFeeMinimum),
      },
    };
  }
  if (!isSol(draft.from.mint) && !isSol(draft.to.mint)) {
    const sol = heldIn(open.spender.wallet, PRIVATE_SOL);
    if (sol < fee + rent)
      return { problem: { kind: "sol-for-fee", held: sol, needed: fee + rent } };
  }
  const inputMint = address(jupiterMint(draft.from.mint));
  const outputMint = address(jupiterMint(draft.to.mint));
  let labels: Promise<ReadonlyMap<string, string>> | null = null;
  const built = await inWalletLane(() =>
    routeTrade({
      feePayer: fees.feePayer,
      labels: () => (labels ??= venueLabels(open.site)),
      ask: async ({ maxAccounts, excludeDexes }) =>
        tradeSwapOf(
          inputMint,
          outputMint,
          await routeFor(open.site, {
            inputMint,
            outputMint,
            amount,
            trader,
            maxAccounts,
            excludeDexes,
            slippageBps: draft.slippageBps,
          }),
        ),
      build: (swap) =>
        buildTradeTransaction(open.client, {
          keypair: open.spender.keypair,
          keys: open.spender.keys,
          wallet: open.spender.wallet,
          feePayer: fees.feePayer,
          treasury: fees.treasury,
          swap,
          ...(quote.solValue === null ? {} : { solValue: quote.solValue }),
          feeMinimum: fees.tradeFeeMinimum,
          priorityFeeLamports: PRIORITY_FEE,
        }),
    }),
  );
  return {
    review: {
      transaction: built.transaction,
      source: draft.source,
      from: draft.from,
      to: draft.to,
      amount,
      outQuoted: quote.outAmount,
      minOut: built.deposit,
      fee: built.fee,
      rent: built.rentFronted - built.rentRefunded,
      priceImpactPercent: quote.priceImpactPercent,
      route: quote.route,
      slippageBps: draft.slippageBps,
    },
  };
}

async function prepareGhost(
  draft: TradeDraft & { readonly to: TradePick },
  ghost: Extract<TradeSource, { kind: "ghost" }>,
  amount: bigint,
  context: Context,
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

const trade = createAction<TradeDraft, TradeProblem, TradeFacts>({
  kind: (review) => (review.source.kind === "ghost" ? "ghost-swap" : "trade"),
  empty: () => ({
    source: { kind: "private" },
    from: SOL_PICK,
    to: null,
    amountText: "",
    slippageBps: 100,
  }),
  another: (draft) => ({ ...draft, amountText: "" }),
  check: (draft) => draftProblem(draft),
  keyOf: (draft) =>
    [
      draft.source.kind === "ghost" ? draft.source.address : "private",
      draft.from.mint,
      draft.to?.mint ?? "",
      draft.amountText.trim(),
      String(draft.slippageBps),
    ].join("|"),
  // A ghost swap pays its own fees: only zSol being off stops it.
  stoppedBy: (why, draft) => draft.source.kind === "private" || why === "off",
  async prepare(draft, context) {
    const to = draft.to;
    if (!to) return { problem: { kind: "no-token" } };
    const read = readAmount(draft.amountText, draft.from.decimals);
    if (!read.ok) return { problem: { kind: "amount", problem: read.problem } };
    const asked = { ...draft, to };
    try {
      return draft.source.kind === "ghost"
        ? await prepareGhost(asked, draft.source, read.amount, context)
        : await preparePrivate(asked, read.amount, context);
    } catch (error) {
      if (error instanceof TradeUnavailable) return { problem: problemOfRefusal(error) };
      if (error instanceof TradeError) return { problem: problemOfTradeError(error) };
      if (error instanceof GhostSwapRefused) return { problem: { kind: "changed" } };
      throw error;
    }
  },
  async submit(review, hooks) {
    const open = spending();
    if (!open) throw new Error("The wallet isn't open.");
    if (review.source.kind === "private") {
      return submitSponsored({
        site: open.site,
        client: open.client,
        spender: open.spender,
        transaction: review.transaction,
        kind: "trade",
        ...hooks,
        readBack,
      });
    }
    const ghost = await ghostKeys(review.source.index);
    if (!ghost || ghost.address !== review.source.address) {
      throw new Error("The ghost wallet's key didn't match its address.");
    }
    const signature = await sendFromGhost({
      client: open.client,
      keys: ghost.keys,
      transaction: review.transaction,
      hooks,
    });
    hooks.onStep("syncing");
    return signature;
  },
  afterDone: () => void readAgain(),
  facts: (review) => ({
    amount: `${formatAmount(review.amount, review.from.decimals)} ${review.from.symbol}`,
    gets: `at least ${formatAmount(review.minOut, review.to.decimals)} ${review.to.symbol}`,
  }),
});

export const {
  setDraft,
  review,
  back,
  confirm,
  checkAgain,
  edit,
  another,
  forget: forgetTrade,
} = trade;
export const useTrade = trade.useState;
export const useTradeDraft = trade.useDraft;
