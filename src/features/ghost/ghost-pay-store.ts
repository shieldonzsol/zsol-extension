// Ghost pay: SOL leaves the private balance for the zSol address, goes into Ghost Route in
// public, and later the pool pays the receiver, at once or in timed parts. Nothing on chain ties
// the private wallet to them. zSol's server builds the deposit and pays the parts out; the panel
// allows the plan with the private wallet's own key and checks the deposit before signing it.
import { address, getBase58Decoder, isAddress, type Address, type Transaction } from "@solana/kit";

import { createAction, type ActionState, type Built, type Paused } from "@/features/action/engine";
import { LeftAtAddress } from "@/features/action/outcomes";
import { SendUnanswered, submitSponsored } from "@/features/action/sponsor";
import { readAmount, type AmountProblem } from "@/features/rings/amount-input";
import { formatAmount } from "@/features/rings/amounts";
import { heldIn } from "@/features/rings/holdings";
import { buildUnshield, UNSHIELD_COST_LAMPORTS } from "@/features/rings/unshield";
import { rememberReceiver } from "@/features/receivers/receivers-store";
import {
  ADDRESS_LOCK,
  inWalletLane,
  readAgain,
  readBack,
  spending,
} from "@/features/wallet/wallet-store";

import { checkedAndSigned } from "./deposit-check";
import {
  dropPlan,
  poolRates,
  PoolStopped,
  preparedDeposit,
  readAhead,
  receiverCheck,
  registerPlan,
  sentDeposit,
  type PoolStopCode,
} from "./pool-api";
import {
  buildPlan,
  DEPOSIT_COST_LAMPORTS,
  planByAmount,
  PLANS,
  planStatement,
  smallestPayout,
  type PlannedPart,
  type PlanName,
} from "./pool-plan";

const SOL = "11111111111111111111111111111111";

export interface GhostPayDraft {
  readonly to: string;
  readonly amountText: string;
  /** Null: the plan the amount starts on. */
  readonly plan: PlanName | null;
  /** A receiver on zSol gets it in their private balance unless this is off. */
  readonly shield: boolean;
  /** It funds one of this wallet's own ghost wallets: its number, from 0. */
  readonly ghost: number | null;
}

export type GhostPayProblem =
  | { readonly kind: "to-empty" }
  | { readonly kind: "bad-address" }
  | { readonly kind: "own" }
  | { readonly kind: "amount"; readonly problem: AmountProblem }
  | { readonly kind: "short"; readonly held: bigint; readonly needed: bigint }
  /** Each part must be at least the pool's smallest payout. */
  | { readonly kind: "too-small"; readonly least: bigint; readonly parts: number }
  | { readonly kind: "listed" }
  | { readonly kind: "pool"; readonly code: PoolStopCode };

export type FormProblem = GhostPayProblem | Paused;

export interface GhostPayFacts {
  /** The Unshield to the zSol address, the first of the two steps. */
  readonly transaction: Transaction;
  readonly to: Address;
  readonly amount: bigint;
  /** What leaves the private balance for the zSol address: the amount and the deposit's cost. */
  readonly leaves: bigint;
  /** The Unshield's network fee, from the private SOL. */
  readonly unshieldFee: bigint;
  readonly poolFee: bigint;
  readonly received: bigint;
  readonly parts: readonly PlannedPart[];
  readonly plan: PlanName;
  /** The receiver is a zSol wallet: the parts arrive in its private balance. */
  readonly shielded: boolean;
  /** The plan's own name, made when it was reviewed. */
  readonly planId: string;
  /** It funds one of this wallet's own ghost wallets: its number. */
  readonly ghost: number | null;
}

export type Review = Built<GhostPayFacts>;
export type GhostPayState = ActionState<GhostPayProblem, GhostPayFacts>;

export function draftProblem(draft: GhostPayDraft, own: string | null): GhostPayProblem | null {
  const to = draft.to.trim();
  if (to === "") return { kind: "to-empty" };
  if (!isAddress(to)) return { kind: "bad-address" };
  if (to === own) return { kind: "own" };
  const read = readAmount(draft.amountText, 9);
  return read.ok ? null : { kind: "amount", problem: read.problem };
}

/** The most SOL a Ghost pay can send: the private SOL less the deposit's cost and the fee. */
export function ghostPayMost(held: bigint): bigint {
  const most = held - DEPOSIT_COST_LAMPORTS - UNSHIELD_COST_LAMPORTS;
  return most > 0n ? most : 0n;
}

const withShield = (part: PlannedPart, shield: boolean): PlannedPart => ({
  recipient: part.recipient,
  amount: part.amount,
  received: part.received,
  afterMs: part.afterMs,
  ...(shield ? { shield: true } : {}),
});

let asks = 0;

const ghostPay = createAction<GhostPayDraft, GhostPayProblem, GhostPayFacts>({
  kind: "ghost-pay",
  empty: () => ({ to: "", amountText: "", plan: null, shield: true, ghost: null }),
  another: (draft) => ({ ...draft, to: "", amountText: "", ghost: null }),
  check: (draft, { own }) => draftProblem(draft, own),
  // Each review shuffles its parts afresh, and its plan gets a name of its own.
  keyOf: () => String((asks += 1)),
  lock: ADDRESS_LOCK,
  async prepare(draft, { open, fees }) {
    const read = readAmount(draft.amountText, 9);
    if (!read.ok) return { problem: { kind: "amount", problem: read.problem } };
    const amount = read.amount;
    const to = address(draft.to.trim());
    const leaves = amount + DEPOSIT_COST_LAMPORTS;
    const held = heldIn(open.spender.wallet, SOL);
    if (held < leaves + UNSHIELD_COST_LAMPORTS) {
      return { problem: { kind: "short", held, needed: leaves + UNSHIELD_COST_LAMPORTS } };
    }
    let rates;
    let receiver;
    try {
      [rates, receiver] = await Promise.all([poolRates(open.site), receiverCheck(open.site, to)]);
    } catch (error) {
      if (error instanceof PoolStopped) return { problem: { kind: "pool", code: error.code } };
      throw error;
    }
    if (receiver.listed) return { problem: { kind: "listed" } };
    const plan = draft.plan ?? planByAmount(amount, rates);
    const built = buildPlan({ amount, name: plan, rates, to });
    if (built === "too-small") {
      return {
        problem: {
          kind: "too-small",
          least: smallestPayout(rates) * BigInt(PLANS[plan].length),
          parts: PLANS[plan].length,
        },
      };
    }
    const shielded = receiver.zsol && draft.shield;
    const own = open.spender.keypair.shieldedAddress().solanaAddress();
    const unshield = await inWalletLane(() =>
      buildUnshield({
        client: open.client,
        keypair: open.spender.keypair,
        wallet: open.spender.wallet,
        keys: open.spender.keys,
        feePayer: fees.feePayer,
        to: own,
        asset: address(SOL),
        amount: leaves,
        opening: null,
      }),
    );
    return {
      review: {
        transaction: unshield.transaction,
        to,
        amount,
        leaves,
        unshieldFee: unshield.networkFee,
        poolFee: built.fee,
        received: built.received,
        parts: built.parts.map((part) => withShield(part, shielded)),
        plan,
        shielded,
        planId: crypto.randomUUID(),
        ghost: draft.ghost,
      },
    };
  },
  async submit(review, hooks) {
    const open = spending();
    if (!open) throw new Error("The wallet isn't open.");
    const { keypair } = open.spender;
    const own = keypair.shieldedAddress().solanaAddress();
    const signer = keypair.toSolanaSigner();
    await registerPlan({
      site: open.site,
      plan: review.planId,
      payer: own,
      parts: review.parts,
      prove: (parts) =>
        getBase58Decoder().decode(
          new Uint8Array(keypair.sign(planStatement({ plan: review.planId, payer: own, parts }))),
        ),
    });
    // zSol's server reads the pool's new notes while the money leaves the private balance.
    const ahead = readAhead(open.site, review.planId);
    try {
      await submitSponsored({
        site: open.site,
        client: open.client,
        spender: open.spender,
        transaction: review.transaction,
        ...hooks,
        readBack,
      });
    } catch (error) {
      // No deposit was made: no plan.
      await dropPlan(open.site, review.planId);
      throw error;
    }
    try {
      await ahead;
      hooks.onStep("sending");
      const wire = await preparedDeposit(open.site, review.planId);
      const signed = await checkedAndSigned({
        client: open.client,
        wire,
        payer: signer,
        amount: review.amount,
        most: review.leaves,
      });
      return await sentDeposit(open.site, review.planId, signed);
    } catch (cause) {
      // Sent and not seen landing: the plan stays, and zSol's server starts it if it landed.
      if (cause instanceof PoolStopped && cause.code === "status-unknown") {
        throw new SendUnanswered("The deposit's answer never arrived.", { cause });
      }
      await dropPlan(open.site, review.planId);
      throw new LeftAtAddress(cause instanceof PoolStopped ? cause.signature : undefined, {
        cause,
      });
    }
  },
  afterDone: (review) => {
    void readAgain();
    // A ghost wallet of one's own isn't someone paid.
    if (review.ghost === null) {
      void rememberReceiver(review.to, review.shielded ? "zsol" : "public");
    }
  },
  facts: (review) => ({
    amount: `${formatAmount(review.amount, 9)} SOL`,
    to: `${review.to.slice(0, 4)}…${review.to.slice(-4)}`,
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
  forget: forgetGhostPay,
} = ghostPay;
export const useGhostPay = ghostPay.useState;
export const useGhostPayDraft = ghostPay.useDraft;

/** Opens Ghost pay to fund one of this wallet's ghost wallets. */
export function fundGhost(index: number, to: string): void {
  const now = ghostPay.peek().kind;
  // A payment on its way keeps its screen; any other starts afresh for this ghost wallet.
  if (now !== "sending") {
    if (now !== "form") ghostPay.another();
    setDraft({ to, ghost: index, amountText: "" });
  }
  window.location.hash = "#/ghost-pay";
}
