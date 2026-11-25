import { describe, expect, it } from "vitest";

import { withLanded } from "./link-wallet";

const SOL = "11111111111111111111111111111111";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("what a link holds", () => {
  it("adds the SOL landed at its address to its private SOL", () => {
    expect(withLanded([{ mint: SOL, amount: 5n }], 7n)).toEqual([{ mint: SOL, amount: 12n }]);
    expect(withLanded([{ mint: USDC, amount: 5n }], 7n)).toEqual([
      { mint: SOL, amount: 7n },
      { mint: USDC, amount: 5n },
    ]);
  });

  it("leaves it as it is when nothing landed", () => {
    expect(withLanded([{ mint: USDC, amount: 5n }], 0n)).toEqual([{ mint: USDC, amount: 5n }]);
    expect(withLanded([], 0n)).toEqual([]);
  });
});
