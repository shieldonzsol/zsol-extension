import { createAction, type ActionState, type Built, type Paused } from "@/features/action/engine";
import {
  buildSweep,
  SweepShortOfRent,
  SweepTooSmall,
  SweepWouldFail,
  type StayingToken,
  type Sweep,
} from "@/features/rings/sweep";
import { formatAmount } from "@/features/rings/amounts";
import { ADDRESS_LOCK, readAgain } from "@/features/wallet/wallet-store";

import { summaryOf, tokenLine, type MoneyLine } from "./money-words";
import { readPublicMoney } from "./public-money";

export type MoveDraft = Readonly<Record<string, never>>;

export type MoveProblem =
  /** Nothing at the address can move; what is there stays, each for its reason. */
  | { readonly kind: "nothing"; readonly staying: readonly StayingToken[] }
  /** The first move registers the wallet, and the address holds too little SOL for that. */
  | { readonly kind: "rent-short"; readonly rent: bigint; readonly held: bigint }
  /** The SOL that would move is less than the network fee it hands back. */
  | { readonly kind: "too-small"; readonly fee: bigint; readonly held: bigint }
  /** It fails in simulation for a reason no token explains. */
  | { readonly kind: "would-fail" };

export type FormProblem = MoveProblem | Paused;
export type Review = Built<Sweep>;
export type MoveState = ActionState<MoveProblem, Sweep>;

/** What a move puts into the private balance, as people read it. */
export function movedLines(review: Sweep): MoneyLine[] {
  return [
    ...(review.sol > 0n
      ? [{ key: "sol", amount: formatAmount(review.sol, 9), symbol: "SOL" }]
      : []),
    ...review.moved.map(tokenLine),
  ];
}

let asks = 0;

const move = createAction<MoveDraft, MoveProblem, Sweep>({
  kind: "move",
  empty: () => ({}),
  another: () => ({}),
  check: () => null,
  // What the address holds can change any moment: each review reads it afresh.
  keyOf: () => String((asks += 1)),
  // A move pays no fee into zSol's fee account, so only the fee wallet's own pause stops it.
  stoppedBy: (why) => why !== "treasury",
  sponsorKind: "sweep",
  lock: ADDRESS_LOCK,
  async prepare(_, { open, fees }) {
    try {
      const built = await buildSweep(open.client, {
        keypair: open.spender.keypair,
        feePayer: fees.feePayer,
      });
      if ("nothing" in built) return { problem: { kind: "nothing", staying: built.staying } };
      return { review: built };
    } catch (error) {
      if (error instanceof SweepShortOfRent) {
        return { problem: { kind: "rent-short", rent: error.rent, held: error.held } };
      }
      if (error instanceof SweepTooSmall) {
        return { problem: { kind: "too-small", fee: error.fee, held: error.held } };
      }
      if (error instanceof SweepWouldFail) return { problem: { kind: "would-fail" } };
      throw error;
    }
  },
  facts: (review) => ({ amount: summaryOf(movedLines(review)) }),
  afterDone(review) {
    // A first move also listed the wallet: read that, and what the address holds now.
    if (review.registryRent !== null) void readAgain();
    void readPublicMoney(review.registryRent === null ? true : null);
  },
});

export const {
  setDraft,
  review,
  back,
  confirm,
  checkAgain,
  edit,
  another,
  forget: forgetMove,
} = move;
export const useMove = move.useState;
