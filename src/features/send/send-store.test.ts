import { describe, expect, it } from "vitest";

import { draftProblem, feeOn } from "./send-store";

const SOL = "11111111111111111111111111111111";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OWN = "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB";
const SIGN_IN = "CjGmj44FNunTsPBg28M3j4skJosYUtuYrYhULoNzGyHs";
const THEM = "3Dt7hkTp2AKev2KELvZgGrttNiNonwSJSTVGS1Ye1xem";

const check = (to: string, amountText: string, mint = SOL) =>
  draftProblem({ to, mint, amountText }, OWN, SIGN_IN);

describe("a send's draft", () => {
  it("names what is wrong with the address first", () => {
    expect(check("", "1")).toEqual({ kind: "to-empty" });
    expect(check("not an address", "1")).toEqual({ kind: "bad-address" });
    expect(check(OWN, "1")).toEqual({ kind: "own" });
    expect(check(` ${SIGN_IN} `, "1")).toEqual({ kind: "sign-in" });
  });

  it("then the amount, in the token's own decimals", () => {
    expect(check(THEM, "")).toEqual({ kind: "amount", problem: "empty" });
    expect(check(THEM, "1,5")).toEqual({ kind: "amount", problem: "comma" });
    expect(check(THEM, "0.0000001", USDC)).toEqual({ kind: "amount", problem: "decimals" });
    expect(check(THEM, "0.0000001")).toBeNull();
  });

  it("charges zSol's stated rate on the tokens zSol charges, nothing on others", () => {
    const terms = { feeAssets: new Set([SOL]), sendFeeBps: 10n, sendFeeMinimums: new Map() };
    expect(feeOn(SOL, 1_000_000n, terms)).toBe(1_000n);
    expect(feeOn(USDC, 1_000_000n, terms)).toBe(0n);
    expect(feeOn(SOL, 1_000_000n, { ...terms, sendFeeBps: 25n })).toBe(2_500n);
    const floored = { ...terms, sendFeeMinimums: new Map([[SOL, 30_000n]]) };
    expect(feeOn(SOL, 1_000_000n, floored)).toBe(30_000n);
    expect(feeOn(SOL, 100_000_000n, floored)).toBe(100_000n);
    expect(feeOn(USDC, 1_000_000n, floored)).toBe(0n);
  });
});
