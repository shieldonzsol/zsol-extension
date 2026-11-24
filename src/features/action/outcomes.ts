// What stopped a send, whether it may have moved money, and what helps next. Every outcome says
// what is true; one that may have moved money never invites a blind retry.
import { buildStopOf, type BuildStop } from "@/features/rings/build-errors";
import { mostWithFee } from "@/features/rings/amount-input";

import {
  landedOf,
  SendUnanswered,
  SendUnconfirmed,
  SponsorRefused,
  SyncBehind,
  type SponsorBudget,
} from "./sponsor";

export type FailureKind =
  | "unconfirmed"
  | "unanswered"
  | "landed-unsynced"
  | "failed-on-chain"
  | "sanctioned"
  | "signed-out"
  | "paused"
  | "stale"
  | "busy"
  /** The account's budget of private actions is used up for now. */
  | "budget"
  | "offline"
  | "unreachable"
  | Exclude<BuildStop, "build">
  | "failed";

export interface FailureFacts {
  readonly kind: FailureKind;
  /** It may have moved money: check before trying again. */
  readonly maybeMoved: boolean;
  readonly signature?: string;
  /** Seconds to wait before trying again. */
  readonly retryAfter?: number;
  readonly budget?: SponsorBudget;
}

/** How long the SDK holds what a built transaction would spend. */
export const HELD_SECONDS = 120;

const BY_CODE: Readonly<Record<string, FailureKind>> = {
  sanctioned: "sanctioned",
  "signed-out": "signed-out",
  unavailable: "paused",
  "fee-short": "stale",
  // zSol's fee wallet would have paid something for the trader: built on old terms.
  "rent-unpaid": "stale",
  busy: "busy",
  "failed-on-chain": "failed-on-chain",
};

const isNetworkError = (error: unknown) =>
  error instanceof TypeError && /fetch|network|load failed|connection/i.test(error.message);

export function failureOf(error: unknown, online: boolean): FailureFacts {
  if (error instanceof SendUnconfirmed) {
    return landedOf(error.cause) === "failed"
      ? { kind: "failed-on-chain", maybeMoved: false, signature: error.signature }
      : { kind: "unconfirmed", maybeMoved: true, signature: error.signature };
  }
  if (error instanceof SyncBehind) {
    return { kind: "landed-unsynced", maybeMoved: true, signature: error.signature };
  }
  if (error instanceof SendUnanswered) return { kind: "unanswered", maybeMoved: true };
  if (!online) return { kind: "offline", maybeMoved: false };
  if (error instanceof SponsorRefused) {
    const kind = error.budget ? "budget" : (BY_CODE[error.code] ?? "failed");
    const wait = error.retryAfterSeconds;
    return {
      kind,
      maybeMoved: false,
      ...(wait !== undefined && wait > 0 ? { retryAfter: Math.ceil(wait) } : {}),
      ...(error.budget ? { budget: error.budget } : {}),
    };
  }
  const stop = buildStopOf(error);
  if (stop === "held") return { kind: "held", maybeMoved: false, retryAfter: HELD_SECONDS };
  if (stop !== null) return { kind: stop === "build" ? "failed" : stop, maybeMoved: false };
  if (isNetworkError(error)) return { kind: "unreachable", maybeMoved: false };
  return { kind: "failed", maybeMoved: false };
}

/** What the private balance lacks for a send, in the token's smallest unit. */
export interface Shortfall {
  readonly held: bigint;
  readonly amount: bigint;
  readonly fee: bigint;
  readonly needed: bigint;
  readonly short: bigint;
  /** The most it can send now, its fee on top. */
  readonly most: bigint;
}

/** The shortfall of sending `amount` with a fee on top; null when the balance covers it. */
export function shortfallOf(input: {
  readonly held: bigint;
  readonly amount: bigint;
  readonly feeOf: (amount: bigint) => bigint;
}): Shortfall | null {
  const fee = input.feeOf(input.amount);
  const needed = input.amount + fee;
  if (needed <= input.held) return null;
  return {
    held: input.held,
    amount: input.amount,
    fee,
    needed,
    short: needed - input.held,
    most: mostWithFee(input.held, input.feeOf),
  };
}
