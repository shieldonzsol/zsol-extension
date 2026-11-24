import { describe, expect, it } from "vitest";

import { tradeFee } from "@/features/rings/trade-fees";

import { draftProblem, feeSideOf, ghostMaxBuy, mostSolIn, SOL_PICK } from "./trade-store";

const USDC = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 };
const draft = (over: Partial<Parameters<typeof draftProblem>[0]> = {}) => ({
  source: { kind: "private" } as const,
  from: SOL_PICK,
  to: USDC,
  amountText: "0.1",
  slippageBps: 100,
  ...over,
});

describe("a trade's draft", () => {
  it("needs a token to get, two different tokens and an amount", () => {
    expect(draftProblem(draft({ to: null }))).toEqual({ kind: "no-token" });
    expect(draftProblem(draft({ to: SOL_PICK }))).toEqual({ kind: "same-token" });
    // Private SOL and Jupiter's wrapped SOL are the same token.
    expect(
      draftProblem(
        draft({
          to: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 },
        }),
      ),
    ).toEqual({ kind: "same-token" });
    expect(draftProblem(draft({ amountText: "0" }))).toEqual({ kind: "amount", problem: "zero" });
    expect(draftProblem(draft())).toBeNull();
  });
});

describe("the SOL a trade's fee is counted on", () => {
  const quote = { outAmount: 7_000_000n, solValue: 50_000_000n };
  it("is what goes in, what comes out, or the quote's worth", () => {
    expect(feeSideOf({ from: SOL_PICK.mint, to: USDC.mint, amount: 100n }, quote)).toBe(100n);
    expect(feeSideOf({ from: USDC.mint, to: SOL_PICK.mint, amount: 100n }, quote)).toBe(7_000_000n);
    expect(feeSideOf({ from: USDC.mint, to: "Bonk", amount: 100n }, quote)).toBe(50_000_000n);
    expect(
      feeSideOf({ from: USDC.mint, to: "Bonk", amount: 100n }, { ...quote, solValue: null }),
    ).toBeNull();
  });
});

describe("the most SOL a trade can put in", () => {
  it("leaves room for zSol's 1% and the rent, never under the least fee", () => {
    const most = mostSolIn(100_000_000n, 1_500_000n, 30_000n);
    expect(most + tradeFee(most, 30_000n) + 1_500_000n).toBeLessThanOrEqual(100_000_000n);
    expect(most + 1n + tradeFee(most + 1n, 30_000n) + 1_500_000n).toBeGreaterThan(100_000_000n);
    const small = mostSolIn(2_000_000n, 1_500_000n, 30_000n);
    expect(small).toBe(470_000n);
    expect(mostSolIn(1_000_000n, 1_500_000n, 30_000n)).toBe(0n);
  });

  it("from a ghost wallet keeps 0.005 SOL and the 1.5%", () => {
    expect(ghostMaxBuy(4_000_000n)).toBe(0n);
    const most = ghostMaxBuy(105_000_000n);
    expect(most + (most * 150n + 9_999n) / 10_000n + 5_000_000n).toBeLessThanOrEqual(105_000_000n);
  });
});
