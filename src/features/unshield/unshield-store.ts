// Unshield from the panel: money leaves the private balance for any public address, in public.
// No fee of zSol's; zSol pays the network fee. A token's new account at the receiver is paid
// from the private SOL in the same transaction.
import { SOL_MINT } from "@heliuslabs/spr";
import { address, isAddress, type Address, type Transaction } from "@solana/kit";

import { createAction, type ActionState, type Built, type Paused } from "@/features/action/engine";
import { readAmount, type AmountProblem } from "@/features/rings/amount-input";
import { formatAmount } from "@/features/rings/amounts";
import { heldIn, WALLET_ASSETS, type Asset } from "@/features/rings/holdings";
import {
  buildUnshield,
  newAccountFloor,
  unshieldAccount,
  UnshieldRentShort,
} from "@/features/rings/unshield";
import { inWalletLane } from "@/features/wallet/wallet-store";

export interface UnshieldDraft {
  readonly to: string;
  readonly mint: string;
  readonly amountText: string;
}

export type UnshieldProblem =
  | { readonly kind: "to-empty" }
  | { readonly kind: "bad-address" }
  /** The private wallet's own zSol address: money would land there in public. */
  | { readonly kind: "own" }
  | { readonly kind: "amount"; readonly problem: AmountProblem }
  | { readonly kind: "short"; readonly held: bigint; readonly amount: bigint }
  /** A token's new account at the receiver costs SOL the private balance doesn't hold. */
  | { readonly kind: "rent-short"; readonly rent: bigint; readonly held: bigint }
  /** An empty address can't hold less SOL than this. */
  | { readonly kind: "too-small-new"; readonly least: bigint };

export type FormProblem = UnshieldProblem | Paused;

export interface UnshieldFacts {
  readonly transaction: Transaction;
  readonly to: Address;
  readonly asset: Asset;
  readonly amount: bigint;
  /** SOL from the private balance to open the receiver's account, zero when it has one. */
  readonly rent: bigint;
  /** The receiver is the wallet the account signs in with. */
  readonly toSignIn: boolean;
}

export type Review = Built<UnshieldFacts>;
export type UnshieldState = ActionState<UnshieldProblem, UnshieldFacts>;

const assetOf = (mint: string): Asset =>
  WALLET_ASSETS.find((asset) => asset.mint === mint) ?? WALLET_ASSETS[0]!;

const short = (to: string) => `${to.slice(0, 4)}…${to.slice(-4)}`;

export function draftProblem(input: UnshieldDraft, own: string | null): UnshieldProblem | null {
  const to = input.to.trim();
  if (to === "") return { kind: "to-empty" };
  if (!isAddress(to)) return { kind: "bad-address" };
  if (to === own) return { kind: "own" };
  const read = readAmount(input.amountText, assetOf(input.mint).decimals);
  return read.ok ? null : { kind: "amount", problem: read.problem };
}

const unshield = createAction<UnshieldDraft, UnshieldProblem, UnshieldFacts>({
  kind: "unshield",
  empty: () => ({ to: "", mint: SOL_MINT, amountText: "" }),
  another: (draft) => ({ to: draft.to, mint: draft.mint, amountText: "" }),
  check: (draft, { own }) => draftProblem(draft, own),
  keyOf: (draft) => `${draft.to.trim()}|${draft.mint}|${draft.amountText.trim()}`,
  async prepare(draft, { open, fees, signInWallet }) {
    const asset = assetOf(draft.mint);
    const read = readAmount(draft.amountText, asset.decimals);
    if (!read.ok) return { problem: { kind: "amount", problem: read.problem } };
    const to = address(draft.to.trim());
    const held = heldIn(open.spender.wallet, asset.mint);
    if (held < read.amount) return { problem: { kind: "short", held, amount: read.amount } };
    const mint = address(asset.mint);
    let opening = null;
    if (asset.mint === SOL_MINT) {
      const floor = await newAccountFloor(open.client, to);
      if (floor !== null && read.amount < floor) {
        return { problem: { kind: "too-small-new", least: floor } };
      }
    } else {
      opening = await unshieldAccount(open.client, { feePayer: fees.feePayer, to, asset: mint });
      const solHeld = heldIn(open.spender.wallet, SOL_MINT);
      if (opening && solHeld < opening.rent) {
        return { problem: { kind: "rent-short", rent: opening.rent, held: solHeld } };
      }
    }
    try {
      const transaction = await inWalletLane(() =>
        buildUnshield({
          client: open.client,
          wallet: open.spender.wallet,
          keys: open.spender.keys,
          feePayer: fees.feePayer,
          to,
          asset: mint,
          amount: read.amount,
          opening,
        }),
      );
      return {
        review: {
          transaction,
          to,
          asset,
          amount: read.amount,
          rent: opening?.rent ?? 0n,
          toSignIn: to === signInWallet,
        },
      };
    } catch (error) {
      if (error instanceof UnshieldRentShort) {
        return { problem: { kind: "rent-short", rent: error.rent, held: error.held } };
      }
      throw error;
    }
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
  forget: forgetUnshield,
} = unshield;
export const useUnshield = unshield.useState;
export const useDraft = unshield.useDraft;
