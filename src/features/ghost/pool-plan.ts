// Ghost Route's payout plans as plain maths: a deposit into the pool is paid out later in parts,
// each at its own time. More parts over a longer time hide more and cost more: the pool keeps a
// share and a flat part of every payout. The figures match zSol's server to the lamport.
import { isAddress } from "@solana/kit";

/** The pool's live settings, as zSol's route answers them. */
export interface PoolRates {
  /** Its share of every payout: 0.0035 is 0.35%. */
  readonly payoutRate: number;
  /** Its flat part of every payout, in SOL. */
  readonly payoutFlat: number;
  /** The smallest payout it sends, in SOL, before its fee. */
  readonly smallestPayout: number;
}

/** The most this panel accepts of the pool's settings, whatever is answered. */
export const RATE_CAPS: PoolRates = { payoutRate: 0.01, payoutFlat: 0.02, smallestPayout: 0.1 };

/** What a deposit costs on top of its amount: two records' rent and its network fee, about. */
export const DEPOSIT_COST_LAMPORTS = 1_556_920n;

const LAMPORTS = 1_000_000_000;

export function payoutFee(amount: bigint, rates: PoolRates): bigint {
  return BigInt(Math.floor(Number(amount) * rates.payoutRate + LAMPORTS * rates.payoutFlat));
}

export function payoutReceived(amount: bigint, rates: PoolRates): bigint {
  const left = amount - payoutFee(amount, rates);
  return left > 0n ? left : 0n;
}

export function smallestPayout(rates: PoolRates): bigint {
  return BigInt(Math.ceil(rates.smallestPayout * LAMPORTS));
}

interface PlanPart {
  /** Hundredths of a percent; a plan's shares add up to 10,000. */
  readonly share: number;
  readonly afterMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const PLAN_NAMES = ["hour", "hour3", "day5", "two", "now"] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

export const PLANS: Readonly<Record<PlanName, readonly PlanPart[]>> = {
  hour: [{ share: 10_000, afterMs: HOUR }],
  hour3: [
    { share: 2_000, afterMs: 10 * MINUTE },
    { share: 3_500, afterMs: 30 * MINUTE },
    { share: 4_500, afterMs: 55 * MINUTE },
  ],
  day5: [
    { share: 1_000, afterMs: HOUR },
    { share: 1_500, afterMs: 4 * HOUR },
    { share: 2_000, afterMs: 9 * HOUR },
    { share: 2_500, afterMs: 15 * HOUR },
    { share: 3_000, afterMs: 22 * HOUR },
  ],
  two: [
    { share: 1_500, afterMs: 2 * MINUTE },
    { share: 8_500, afterMs: 10 * MINUTE },
  ],
  now: [{ share: 10_000, afterMs: 0 }],
};

const MAX_WAIT_MS = 7 * 24 * HOUR;
const SHARE_SWING = 0.2;
const WAIT_STRETCH = 0.5;
const FLAT_FEE_BUDGET = 0.02;

/** The plan an amount starts on: the most parts whose flat fees stay under 2% of it. */
export function planByAmount(amount: bigint, rates: PoolRates): PlanName {
  const flat = LAMPORTS * rates.payoutFlat;
  const budget = Number(amount) * FLAT_FEE_BUDGET;
  if (flat * PLANS.day5.length <= budget) return "day5";
  if (flat * PLANS.hour3.length <= budget) return "hour3";
  return "hour";
}

export interface PlannedPart {
  readonly recipient: string;
  /** What leaves the pool, in lamports. */
  readonly amount: bigint;
  /** What reaches the receiver, after the pool's fee. */
  readonly received: bigint;
  readonly afterMs: number;
  /** Arrives in the receiver's private balance, not at their address in public. */
  readonly shield?: boolean;
}

export interface BuiltPlan {
  readonly parts: readonly PlannedPart[];
  /** What the pool keeps of all its parts. */
  readonly fee: bigint;
  readonly received: bigint;
}

/** A part would be below the pool's smallest payout. */
export type PlanStop = "too-small";

const randomDraw = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

/**
 * The parts of `amount` under a plan: each share moved by up to a fifth and each wait stretched
 * by up to half, so two people on the same plan don't make the same parts.
 */
export function buildPlan(input: {
  readonly amount: bigint;
  readonly name: PlanName;
  readonly rates: PoolRates;
  readonly to: string;
  /** Draws from 0 up to 1; a fixed one keeps a preview still. */
  readonly draw?: () => number;
}): BuiltPlan | PlanStop {
  const { amount, rates } = input;
  const spec = PLANS[input.name];
  const smallest = smallestPayout(rates);
  if (amount < smallest * BigInt(spec.length)) return "too-small";
  const draw = () => Math.min(Math.max((input.draw ?? randomDraw)(), 0), 1);
  const weights = spec.map((part) => part.share * (1 - SHARE_SWING + 2 * SHARE_SWING * draw()));
  const whole = weights.reduce((sum, weight) => sum + weight, 0);
  const amounts = weights.map((weight) => BigInt(Math.floor((Number(amount) * weight) / whole)));
  amounts[amounts.length - 1]! += amount - amounts.reduce((sum, each) => sum + each, 0n);
  for (let index = 0; index < amounts.length; index += 1) {
    const short = smallest - amounts[index]!;
    if (short <= 0n) continue;
    const largest = amounts.indexOf(amounts.reduce((a, b) => (b > a ? b : a)));
    amounts[largest]! -= short;
    amounts[index] = smallest;
  }
  const parts = spec.map((part, index) => ({
    recipient: input.to,
    amount: amounts[index]!,
    received: payoutReceived(amounts[index]!, rates),
    afterMs: Math.min(Math.floor(part.afterMs * (1 + WAIT_STRETCH * draw())), MAX_WAIT_MS),
  }));
  return {
    parts,
    fee: parts.reduce((sum, part) => sum + payoutFee(part.amount, rates), 0n),
    received: parts.reduce((sum, part) => sum + part.received, 0n),
  };
}

/** What the private wallet signs to allow a plan: plain text, never readable as a transaction. */
export function planStatement(input: {
  readonly plan: string;
  readonly payer: string;
  readonly parts: readonly PlannedPart[];
}): Uint8Array {
  if (!isAddress(input.payer)) throw new Error("The payer isn't an address.");
  return new TextEncoder().encode(
    [
      "zSol pool plan v1",
      `plan: ${input.plan}`,
      "way: out",
      `payer: ${input.payer}`,
      ...input.parts.map(
        (part, index) =>
          `part ${String(index)}: ${part.recipient} ${String(part.amount)} ${String(part.afterMs)}${
            part.shield ? " shielded" : ""
          }`,
      ),
    ].join("\n"),
  );
}
