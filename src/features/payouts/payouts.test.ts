import { describe, expect, it } from "vitest";

import { newsFor, newsOf, payoutRowsOf, type PayoutRow } from "./payouts";

const TO = "B6eQvuQHsGxwcCC9qtqyHTTa2XNiWDh9v3tn7GUswMmD";
const row = (over: Partial<PayoutRow>): PayoutRow => ({
  id: 1,
  plan: "p",
  part: 0,
  recipient: TO,
  state: "due",
  received: null,
  amount: 10_000_000n,
  shield: false,
  ...over,
});

describe("Ghost Route payout news", () => {
  it("reads zSol's rows and leaves out what it can't read", () => {
    const rows = payoutRowsOf({
      payouts: [
        {
          id: 7,
          plan: "p",
          part: 0,
          recipient: TO,
          state: "paid",
          amount: "10000000",
          received: "3965000",
          shield: false,
        },
        { id: 8, plan: "p", part: 1, recipient: TO, state: "lost", amount: "1" },
        { id: "9" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.received).toBe(3_965_000n);
  });

  it("tells each part once, then lets the plan go when every part has an outcome", () => {
    const watch = { plans: [{ plan: "p", since: 0 }], told: [] };
    const first = newsFor([row({ id: 1, state: "paid" }), row({ id: 2, part: 1 })], watch, 1);
    expect(first.tell.map((each) => each.id)).toEqual([1]);
    expect(first.next.plans).toHaveLength(1);
    const second = newsFor(
      [row({ id: 1, state: "paid" }), row({ id: 2, part: 1, state: "failed" })],
      first.next,
      2,
    );
    expect(second.tell.map((each) => each.id)).toEqual([2]);
    expect(second.next.plans).toHaveLength(0);
  });

  it("keeps a plan not seen yet, and lets an old one go", () => {
    const watch = { plans: [{ plan: "new", since: 0 }], told: [] };
    expect(newsFor([], watch, 1).next.plans).toHaveLength(1);
    expect(newsFor([], watch, 9 * 24 * 60 * 60_000).next.plans).toHaveLength(0);
  });

  it("says where it landed, or that it stopped", () => {
    expect(newsOf(row({ state: "paid", received: 3_965_000n })).message).toBe(
      "0.003965 SOL reached B6eQ…wMmD.",
    );
    expect(newsOf(row({ state: "paid", shield: true, received: 1n })).message).toContain(
      "private balance",
    );
    expect(newsOf(row({ state: "failed" })).title).toBe("A Ghost Route payout stopped");
  });
});
