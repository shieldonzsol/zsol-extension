import { describe, expect, it } from "vitest";

import {
  buildPlan,
  payoutFee,
  planByAmount,
  PLANS,
  planStatement,
  smallestPayout,
  type PoolRates,
} from "./pool-plan";

const RATES: PoolRates = { payoutRate: 0.0035, payoutFlat: 0.006, smallestPayout: 0.01 };
const TO = "KdoNLUukCVa2jKqGhur5QWVe8FFeui4xUzwodWxZet7";

describe("Ghost Route's plans", () => {
  it("charges the pool's share and flat part on each payout", () => {
    expect(payoutFee(12_000_000n, RATES)).toBe(6_042_000n);
    expect(smallestPayout(RATES)).toBe(10_000_000n);
  });

  it("splits an amount into its plan's parts, all of it, none below the smallest payout", () => {
    for (const name of ["hour", "hour3", "day5", "two", "now"] as const) {
      const built = buildPlan({ amount: 2_000_000_000n, name, rates: RATES, to: TO });
      if (built === "too-small") throw new Error(name);
      expect(built.parts).toHaveLength(PLANS[name].length);
      expect(built.parts.reduce((sum, part) => sum + part.amount, 0n)).toBe(2_000_000_000n);
      for (const part of built.parts) expect(part.amount).toBeGreaterThanOrEqual(10_000_000n);
      expect(built.received + built.fee).toBe(2_000_000_000n);
    }
  });

  it("refuses an amount its parts can't each carry", () => {
    expect(buildPlan({ amount: 9_000_000n, name: "hour", rates: RATES, to: TO })).toBe("too-small");
    expect(buildPlan({ amount: 40_000_000n, name: "day5", rates: RATES, to: TO })).toBe(
      "too-small",
    );
  });

  it("starts an amount on the most parts worth their flat fees", () => {
    expect(planByAmount(100_000_000n, RATES)).toBe("hour");
    expect(planByAmount(1_000_000_000n, RATES)).toBe("hour3");
    expect(planByAmount(2_000_000_000n, RATES)).toBe("day5");
  });

  it("states a plan as zSol's server reads it", () => {
    const text = new TextDecoder().decode(
      planStatement({
        plan: "3f58834d-b847-4757-8f4e-cd58108988a5",
        payer: "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB",
        parts: [
          { recipient: TO, amount: 10_000_000n, received: 3_965_000n, afterMs: 600_000 },
          { recipient: TO, amount: 20_000_000n, received: 13_930_000n, afterMs: 0, shield: true },
        ],
      }),
    );
    expect(text).toBe(
      [
        "zSol pool plan v1",
        "plan: 3f58834d-b847-4757-8f4e-cd58108988a5",
        "way: out",
        "payer: GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB",
        `part 0: ${TO} 10000000 600000`,
        `part 1: ${TO} 20000000 0 shielded`,
      ].join("\n"),
    );
  });
});
