// Pay many from the panel: up to 14 zSol addresses in one private transaction, zSol's fee the
// 15th output on the total. Every payee must hold a private wallet: the review names the ones who
// don't, and nothing is built.
import { buildMultiTransferTransaction, SOL_MINT } from "@heliuslabs/spr";
import { isWalletRegistered } from "@heliuslabs/spr/wallet";
import { address, type Address, type Transaction } from "@solana/kit";

import { createAction, type ActionState, type Built, type Paused } from "@/features/action/engine";
import { shortfallOf, type Shortfall } from "@/features/action/outcomes";
import { feeOn, leastFeeOn } from "@/features/action/terms";
import { formatAmount } from "@/features/rings/amounts";
import { heldIn, WALLET_ASSETS, type Asset } from "@/features/rings/holdings";
import { inWalletLane } from "@/features/wallet/wallet-store";

import { MAX_PAYEES, parsePayList, splitPayments, type LineProblem, type PayRow } from "./pay-list";

export interface PayManyDraft {
  readonly list: string;
  readonly mint: string;
  /** Payments left from a list longer than one transaction pays, to pay next. */
  readonly rest: string;
}

export type PayManyProblem =
  | { readonly kind: "empty" }
  | { readonly kind: "too-many"; readonly count: number }
  | {
      readonly kind: "line";
      readonly problem: LineProblem;
      readonly line: number;
      readonly also: readonly number[];
    }
  | { readonly kind: "short"; readonly short: Shortfall }
  | { readonly kind: "no-wallet"; readonly addresses: readonly string[] };

export type FormProblem = PayManyProblem | Paused;

export interface PayManyFacts {
  readonly transaction: Transaction;
  readonly asset: Asset;
  readonly rows: readonly { readonly to: Address; readonly amount: bigint }[];
  readonly total: bigint;
  readonly fee: bigint;
  readonly feeBps: bigint;
  readonly feeLeast: bigint;
}

export type Review = Built<PayManyFacts>;
export type PayManyState = ActionState<PayManyProblem, PayManyFacts>;

const assetOf = (mint: string): Asset =>
  WALLET_ASSETS.find((asset) => asset.mint === mint) ?? WALLET_ASSETS[0]!;

function rowsOf(draft: PayManyDraft, own: string): readonly PayRow[] | PayManyProblem {
  const list = parsePayList(draft.list, assetOf(draft.mint).decimals, own);
  if (list.ok) return list.rows;
  if (list.problem === "empty") return { kind: "empty" };
  if (list.problem === "too-many") return { kind: "too-many", count: list.count };
  return { kind: "line", problem: list.problem, line: list.line, also: list.also };
}

const payMany = createAction<PayManyDraft, PayManyProblem, PayManyFacts>({
  kind: "pay-many",
  empty: () => ({ list: "", mint: SOL_MINT, rest: "" }),
  // After a list is paid, what was left of it comes next.
  another: (draft) => ({ list: draft.rest, mint: draft.mint, rest: "" }),
  check: (draft, { own }) => {
    const rows = rowsOf(draft, own);
    return "kind" in rows ? rows : null;
  },
  keyOf: (draft) => `${draft.mint}|${draft.list.trim()}`,
  async prepare(draft, { open, fees, own }) {
    const asset = assetOf(draft.mint);
    const rows = rowsOf(draft, own);
    if ("kind" in rows) return { problem: rows };
    const total = rows.reduce((sum, row) => sum + row.amount, 0n);
    const lack = shortfallOf({
      held: heldIn(open.spender.wallet, asset.mint),
      amount: total,
      feeOf: (amount) => feeOn(asset.mint, amount, fees),
    });
    if (lack) return { problem: { kind: "short", short: lack } };
    const payees = rows.map((row) => address(row.address));
    const listed = await Promise.all(
      payees.map((owner) => isWalletRegistered({ rpc: open.client, owner })),
    );
    const missing = payees.filter((_, at) => !listed[at]);
    if (missing.length > 0) return { problem: { kind: "no-wallet", addresses: missing } };
    const fee = feeOn(asset.mint, total, fees);
    const payments = [
      ...rows.map((row) => ({ recipient: address(row.address), amount: row.amount })),
      ...(fee > 0n ? [{ recipient: fees.treasury, amount: fee }] : []),
    ];
    const transaction = await inWalletLane(() =>
      buildMultiTransferTransaction({
        client: open.client,
        wallet: open.spender.wallet,
        keys: open.spender.keys,
        feePayer: fees.feePayer,
        asset: address(asset.mint),
        payments,
      }),
    );
    return {
      review: {
        transaction,
        asset,
        rows: rows.map((row) => ({ to: address(row.address), amount: row.amount })),
        total,
        fee,
        feeBps: fees.sendFeeBps,
        feeLeast: leastFeeOn(asset.mint, fees),
      },
    };
  },
  facts: (review) => ({
    amount: `${formatAmount(review.total, review.asset.decimals)} ${review.asset.symbol}`,
    count: review.rows.length,
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
  forget: forgetPayMany,
} = payMany;
export const usePayMany = payMany.useState;
export const useDraft = payMany.useDraft;

/** Keeps the first 14 payments to pay now, and the rest for after. */
export function payFirstNow(draft: PayManyDraft) {
  const { first, rest } = splitPayments(draft.list, MAX_PAYEES);
  setDraft({
    list: first,
    rest: [rest, draft.rest].filter((part) => part.trim() !== "").join("\n"),
  });
}
