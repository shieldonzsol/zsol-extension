// Making a Dark link from the panel: a one-time private wallet, its key from the trader's own,
// paid from the private balance. zSol's fee also pays ahead for the claim, so claiming the link
// or taking it back costs nothing. The link is listed before it is paid, so it is never lost.
import {
  buildMultiTransferTransaction,
  buildTransferTransaction,
  type ShieldedAddress,
} from "@heliuslabs/spr";
import { address, type Address, type Transaction } from "@solana/kit";

import { createAction, type ActionState, type Built, type Paused } from "@/features/action/engine";
import { shortfallOf, type Shortfall } from "@/features/action/outcomes";
import { SponsorRefused, submitSponsored } from "@/features/action/sponsor";
import { feeOn, fundingFeeOn, leastFeeOn } from "@/features/action/terms";
import { readAmount, type AmountProblem } from "@/features/rings/amount-input";
import { formatAmount } from "@/features/rings/amounts";
import { heldIn, WALLET_ASSETS, type Asset } from "@/features/rings/holdings";
import { privateKeypair } from "@/features/rings/keys";
import { darkLinkCode } from "@/features/rings/links";
import {
  assetFor,
  inWalletLane,
  linkKey,
  readBack,
  spending,
} from "@/features/wallet/wallet-store";

import { listLink, nextIndex, readLinks } from "./link-api";
import { refreshLinks } from "./links-store";

export interface LinkDraft {
  readonly mint: string;
  readonly amountText: string;
}

export type LinkProblem =
  | { readonly kind: "amount"; readonly problem: AmountProblem }
  | { readonly kind: "short"; readonly short: Shortfall };

export type FormProblem = LinkProblem | Paused;

export interface LinkFacts {
  readonly transaction: Transaction;
  readonly asset: Asset;
  readonly amount: bigint;
  /** zSol's fee in all: a send's, and the claim's network fee paid ahead. */
  readonly fee: bigint;
  /** The claim's network fee within it. */
  readonly ahead: bigint;
  readonly feeBps: bigint;
  readonly feeLeast: bigint;
  /** The link's number in the trader's key tree. */
  readonly index: number;
  /** The link's one-time address: public once paid. */
  readonly address: Address;
  readonly link: ShieldedAddress;
  /** The link's key in base58: the part after the `#`. */
  readonly code: string;
}

export type Review = Built<LinkFacts>;
export type LinkState = ActionState<LinkProblem, LinkFacts>;

const SOL_MINT = WALLET_ASSETS[0]?.mint ?? "11111111111111111111111111111111";

const shortOf = (value: string) => `${value.slice(0, 4)}…${value.slice(-4)}`;

const link = createAction<LinkDraft, LinkProblem, LinkFacts>({
  kind: "dark-link",
  empty: () => ({ mint: SOL_MINT, amountText: "" }),
  another: (draft) => ({ mint: draft.mint, amountText: "" }),
  check: (draft) => {
    const read = readAmount(draft.amountText, assetFor(draft.mint).decimals);
    return read.ok ? null : { kind: "amount", problem: read.problem };
  },
  keyOf: (draft) => `${draft.mint}|${draft.amountText.trim()}`,
  async prepare(draft, { open, fees }) {
    const asset = assetFor(draft.mint);
    const read = readAmount(draft.amountText, asset.decimals);
    if (!read.ok) return { problem: { kind: "amount", problem: read.problem } };
    const lack = shortfallOf({
      held: heldIn(open.spender.wallet, asset.mint),
      amount: read.amount,
      feeOf: (amount) => fundingFeeOn(asset.mint, amount, fees),
    });
    if (lack) return { problem: { kind: "short", short: lack } };
    const index = nextIndex(await readLinks(open.site));
    const key = await linkKey(index);
    if (!key) throw new Error("The wallet closed.");
    try {
      const shielded = (await privateKeypair(key)).shieldedAddress();
      const fee = fundingFeeOn(asset.mint, read.amount, fees);
      const common = {
        client: open.client,
        wallet: open.spender.wallet,
        keys: open.spender.keys,
        feePayer: fees.feePayer,
        asset: address(asset.mint),
      };
      // The link's payment, and zSol's fee as one more hidden output to its treasury.
      const transaction = await inWalletLane(() =>
        fee > 0n
          ? buildMultiTransferTransaction({
              ...common,
              payments: [
                { recipient: shielded, amount: read.amount },
                { recipient: fees.treasury, amount: fee },
              ],
            })
          : buildTransferTransaction({ ...common, recipient: shielded, amount: read.amount }),
      );
      return {
        review: {
          transaction,
          asset,
          amount: read.amount,
          fee,
          ahead: fee > 0n ? fee - feeOn(asset.mint, read.amount, fees) : 0n,
          feeBps: fees.sendFeeBps,
          feeLeast: leastFeeOn(asset.mint, fees),
          index,
          address: shielded.solanaAddress(),
          link: shielded,
          code: darkLinkCode(key),
        },
      };
    } finally {
      key.fill(0);
    }
  },
  async submit(review, hooks) {
    const open = spending();
    if (!open) throw new Error("The wallet closed.");
    const listed = await listLink(open.site, review.index, review.address);
    if (listed !== "ok") throw new SponsorRefused(listed === "taken" ? "link-taken" : "refused");
    // Listed now, paid or not: the list shows it either way.
    void refreshLinks();
    return submitSponsored({
      site: open.site,
      client: open.client,
      spender: open.spender,
      transaction: review.transaction,
      known: [review.link],
      funds: true,
      onStep: hooks.onStep,
      onSigned: hooks.onSigned,
      onSent: hooks.onSent,
      readBack,
    });
  },
  afterDone: () => void refreshLinks(),
  facts: (review) => ({
    amount: `${formatAmount(review.amount, review.asset.decimals)} ${review.asset.symbol}`,
    to: shortOf(review.address),
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
  forget: forgetDarkLink,
} = link;
export const useDarkLink = link.useState;
export const useDraft = link.useDraft;
