// Trade from the panel: any pair Jupiter routes, from the private balance (zSol's 1%, the swap at
// the private wallet's own address, the output back into the private balance) or from a ghost
// wallet (zSol's 1.5%, a swap zSol's server builds whole and the panel checks before the ghost
// key signs).
import { address, type Address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";

import {
  createAction,
  type ActionContext,
  type ActionState,
  type Built,
  type Paused,
} from "@/features/action/engine";
import { submitSponsored, type SponsorSetup } from "@/features/action/sponsor";
import { readAmount } from "@/features/rings/amount-input";
import { formatAmount } from "@/features/rings/amounts";
import { GhostSwapRefused } from "@/features/rings/ghost-swap";
import { heldIn } from "@/features/rings/holdings";
import { tokenInfo } from "@/features/rings/token-info";
import { routeTrade, TradeError, tradeSwapOf } from "@/features/rings/trade";
import { buildTradeTransaction } from "@/features/rings/trade-build";
import { tradeFee } from "@/features/rings/trade-fees";
import { tokenProgramOf } from "@/features/rings/unshield";
import type { SprClient } from "@/features/rings/client";
import {
  ADDRESS_LOCK,
  ghostKeys,
  inWalletLane,
  readAgain,
  readBack,
  spending,
} from "@/features/wallet/wallet-store";

import { sendFromGhost } from "./ghost-send";
import {
  draftProblem,
  feeSideOf,
  mostSolIn,
  prepareGhostSwap,
  PRIORITY_FEE,
  problemOfRefusal,
  problemOfTradeError,
  SOL_PICK,
  TOKEN_ACCOUNT_BYTES,
  type TradeDraft,
  type TradeFacts,
  type TradePick,
  type TradeProblem,
} from "./trade-model";

export {
  draftProblem,
  feeSideOf,
  ghostMaxBuy,
  GHOST_KEEP_LAMPORTS,
  GHOST_SELL_LAMPORTS,
  mostSolIn,
  SLIPPAGES,
  SOL_PICK,
  type TradeDraft,
  type TradeFacts,
  type TradePick,
  type TradeProblem,
  type TradeSource,
} from "./trade-model";
import {
  isSol,
  jupiterMint,
  PRIVATE_SOL,
  quoteTrade,
  routeFor,
  TradeUnavailable,
  venueLabels,
} from "./trade-api";

export type FormProblem = TradeProblem | Paused;

export type Review = Built<TradeFacts>;
type Context = ActionContext & { readonly fees: SponsorSetup };
export type TradeState = ActionState<TradeProblem, TradeFacts>;

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
        ? await prepareGhostSwap(asked, draft.source, read.amount, context)
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
  lock: ADDRESS_LOCK,
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
