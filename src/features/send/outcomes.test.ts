import { signature } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { feeAt } from "@/features/rings/amount-input";

import { failureOf, shortfallOf } from "./outcomes";
import { SendUnanswered, SendUnconfirmed, SponsorRefused, SyncBehind } from "./sponsor";

const sendFee = (amount: bigint) => feeAt(amount, 10n);

const SIGNATURE = signature(
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW",
);

describe("what stopped a send", () => {
  it("never reads a send that may have landed as nothing moved", () => {
    expect(failureOf(new SendUnconfirmed(SIGNATURE), true)).toMatchObject({
      kind: "unconfirmed",
      maybeMoved: true,
    });
    expect(
      failureOf(
        new SendUnconfirmed(SIGNATURE, {
          cause: { details: { reason: "transaction failed" } },
        }),
        true,
      ),
    ).toMatchObject({ kind: "failed-on-chain", maybeMoved: false });
    expect(failureOf(new SyncBehind(SIGNATURE), true).kind).toBe("landed-unsynced");
    expect(failureOf(new SendUnanswered("lost"), false)).toMatchObject({
      kind: "unanswered",
      maybeMoved: true,
    });
  });

  it("reads zSol's refusals and the SDK's reasons", () => {
    expect(failureOf(new SponsorRefused("sanctioned"), true).kind).toBe("sanctioned");
    expect(failureOf(new SponsorRefused("busy", 4.2), true)).toMatchObject({
      kind: "busy",
      retryAfter: 5,
    });
    expect(failureOf(new SponsorRefused("output-mismatch"), true).kind).toBe("failed");
    expect(
      failureOf({ code: "WALLET_BUILD_TRANSFER", causeCode: "WALLET_NOTE_RESERVED" }, true),
    ).toMatchObject({ kind: "held", retryAfter: 120 });
    expect(failureOf(new TypeError("Failed to fetch"), true).kind).toBe("unreachable");
    expect(failureOf(new TypeError("Failed to fetch"), false).kind).toBe("offline");
  });
});

describe("a short balance", () => {
  it("says by how much, and the most that fits with the fee", () => {
    const short = shortfallOf({ held: 1_000_000n, amount: 1_000_000n, feeOf: sendFee });
    expect(short).toMatchObject({ fee: 1_000n, needed: 1_001_000n, short: 1_000n });
    expect(short && short.most + sendFee(short.most)).toBeLessThanOrEqual(1_000_000n);
    expect(shortfallOf({ held: 2_000_000n, amount: 1_000_000n, feeOf: sendFee })).toBeNull();
  });
});
