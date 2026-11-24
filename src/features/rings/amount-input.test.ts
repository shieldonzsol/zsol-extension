import { describe, expect, it } from "vitest";

import { feeAt, mostWithFee, percentOf, plainAmount, readAmount } from "./amount-input";

const sendFee = (amount: bigint) => feeAt(amount, 10n);

describe("a typed amount", () => {
  it("reads what people type", () => {
    expect(readAmount("1.5", 9)).toEqual({ ok: true, amount: 1_500_000_000n });
    expect(readAmount(".5", 6)).toEqual({ ok: true, amount: 500_000n });
    expect(readAmount("1,500.25", 6)).toEqual({ ok: true, amount: 1_500_250_000n });
  });

  it("names what is wrong, never guessing", () => {
    expect(readAmount("", 9)).toEqual({ ok: false, problem: "empty" });
    expect(readAmount("1,5", 9)).toEqual({ ok: false, problem: "comma" });
    expect(readAmount("0,001", 9)).toEqual({ ok: false, problem: "comma" });
    expect(readAmount("0,500.5", 9)).toEqual({ ok: false, problem: "comma" });
    expect(readAmount("1,000", 9)).toEqual({ ok: true, amount: 1_000_000_000_000n });
    expect(readAmount("abc", 9)).toEqual({ ok: false, problem: "not-amount" });
    expect(readAmount("0.0000001", 6)).toEqual({ ok: false, problem: "decimals" });
    expect(readAmount("0", 9)).toEqual({ ok: false, problem: "zero" });
    expect(readAmount(".", 9)).toEqual({ ok: false, problem: "not-amount" });
  });

  it("writes an amount back as a field takes it", () => {
    expect(plainAmount(1_500_000_000n, 9)).toBe("1.5");
    expect(plainAmount(2_000_000n, 6)).toBe("2");
  });
});

describe("a fee in basis points", () => {
  it("reads as a percentage", () => {
    expect(percentOf(10n)).toBe("0.1%");
    expect(percentOf(25n)).toBe("0.25%");
    expect(feeAt(1_000_000n, 0n)).toBe(0n);
  });

  it("is never under its minimum, and nothing on nothing", () => {
    expect(feeAt(1_000_000n, 10n, 30_000n)).toBe(30_000n);
    expect(feeAt(50_000_000n, 10n, 30_000n)).toBe(50_000n);
    expect(feeAt(0n, 10n, 30_000n)).toBe(0n);
    const most = mostWithFee(18_038_840n, (amount) => feeAt(amount, 10n, 30_000n));
    expect(most).toBe(18_008_840n);
    expect(mostWithFee(30_000n, (amount) => feeAt(amount, 10n, 30_000n))).toBe(0n);
  });

  it("rounds up, so a fee owed is never zero", () => {
    expect(sendFee(1n)).toBe(1n);
    expect(sendFee(10_000n)).toBe(10n);
    expect(sendFee(10_001n)).toBe(11n);
    expect(sendFee(0n)).toBe(0n);
  });

  it("finds the most that fits with its fee on top", () => {
    const most = mostWithFee(1_000_000_000n, sendFee);
    expect(most + sendFee(most)).toBeLessThanOrEqual(1_000_000_000n);
    expect(most + 1n + sendFee(most + 1n)).toBeGreaterThan(1_000_000_000n);
    expect(mostWithFee(0n, sendFee)).toBe(0n);
  });
});
