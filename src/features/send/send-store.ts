// Send dark from the panel: pay a zSol address from the private balance. The amount and the
// token stay hidden; zSol's fee rides in the same transaction and zSol pays the network fee.
import { buildMultiTransferTransaction, buildTransferTransaction } from "@heliuslabs/spr";
import { isWalletRegistered } from "@heliuslabs/spr/wallet";
import { address, isAddress, type Address, type Transaction } from "@solana/kit";

import { createAction, type ActionState, type Built, type Paused } from "@/features/action/engine";
import { shortfallOf, type Shortfall } from "@/features/action/outcomes";
import { feeOn, leastFeeOn } from "@/features/action/terms";
import { readAmount, type AmountProblem } from "@/features/rings/amount-input";
import { formatAmount } from "@/features/rings/amounts";
import { heldIn, WALLET_ASSETS, type Asset } from "@/features/rings/holdings";
import { inWalletLane } from "@/features/wallet/wallet-store";

export interface SendDraft {
  readonly to: string;
  readonly mint: string;
  readonly amountText: string;
}

export type SendProblem =
  | { readonly kind: "to-empty" }
  | { readonly kind: "bad-address" }
  | { readonly kind: "own" }
  | { readonly kind: "sign-in" }
  | { readonly kind: "no-wallet" }
  | { readonly kind: "amount"; readonly problem: AmountProblem }
  | { readonly kind: "short"; readonly short: Shortfall };

export type FormProblem = SendProblem | Paused;

export interface SendFacts {
  readonly transaction: Transaction;
  readonly to: Address;
  readonly asset: Asset;
  readonly amount: bigint;
  readonly fee: bigint;
  /** The rate the fee was worked out at, in basis points. */
  readonly feeBps: bigint;
  /** zSol's least fee on a send of this token, zero when it states none. */
  readonly feeLeast: bigint;
}

export type Review = Built<SendFacts>;
export type SendState = ActionState<SendProblem, SendFacts>;

const SOL_MINT = WALLET_ASSETS[0]?.mint ?? "11111111111111111111111111111111";

const assetOf = (mint: string): Asset =>
  WALLET_ASSETS.find((asset) => asset.mint === mint) ?? WALLET_ASSETS[0]!;

const short = (to: string) => `${to.slice(0, 4)}…${to.slice(-4)}`;

/** The checks that need no network: the address and the amount. */
export function draftProblem(
  input: SendDraft,
  own: string | null,
  signInWallet: string,
): SendProblem | null {
  const to = input.to.trim();
  if (to === "") return { kind: "to-empty" };
  if (!isAddress(to)) return { kind: "bad-address" };
  if (to === own) return { kind: "own" };
  if (to === signInWallet) return { kind: "sign-in" };
  const read = readAmount(input.amountText, assetOf(input.mint).decimals);
  return read.ok ? null : { kind: "amount", problem: read.problem };
}

const send = createAction<SendDraft, SendProblem, SendFacts>({
  kind: "send-dark",
  empty: () => ({ to: "", mint: SOL_MINT, amountText: "" }),
  another: (draft) => ({ to: "", mint: draft.mint, amountText: "" }),
  check: (draft, { own, signInWallet }) => draftProblem(draft, own, signInWallet),
  keyOf: (draft) => `${draft.to.trim()}|${draft.mint}|${draft.amountText.trim()}`,
  recipientProblem: { kind: "no-wallet" },
  async prepare(draft, { open, fees }) {
    const asset = assetOf(draft.mint);
    const read = readAmount(draft.amountText, asset.decimals);
    if (!read.ok) return { problem: { kind: "amount", problem: read.problem } };
    const to = address(draft.to.trim());
    const lack = shortfallOf({
      held: heldIn(open.spender.wallet, asset.mint),
      amount: read.amount,
      feeOf: (amount) => feeOn(asset.mint, amount, fees),
    });
    if (lack) return { problem: { kind: "short", short: lack } };
    if (!(await isWalletRegistered({ rpc: open.client, owner: to }))) {
      return { problem: { kind: "no-wallet" } };
    }
    const fee = feeOn(asset.mint, read.amount, fees);
    const common = {
      client: open.client,
      wallet: open.spender.wallet,
      keys: open.spender.keys,
      feePayer: fees.feePayer,
      asset: address(asset.mint),
    };
    // One payment, and zSol's fee as one more hidden output to its treasury.
    const transaction = await inWalletLane(() =>
      fee > 0n
        ? buildMultiTransferTransaction({
            ...common,
            payments: [
              { recipient: to, amount: read.amount },
              { recipient: fees.treasury, amount: fee },
            ],
          })
        : buildTransferTransaction({ ...common, recipient: to, amount: read.amount }),
    );
    return {
      review: {
        transaction,
        to,
        asset,
        amount: read.amount,
        fee,
        feeBps: fees.sendFeeBps,
        feeLeast: leastFeeOn(asset.mint, fees),
      },
    };
  },
  facts: (review) => ({
    amount: `${formatAmount(review.amount, review.asset.decimals)} ${review.asset.symbol}`,
    to: short(review.to),
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
  forget: forgetSend,
} = send;
export const useSend = send.useState;
export const useDraft = send.useDraft;
export { feeOn, useFeeTerms, warmTerms as warmFees } from "@/features/action/terms";
