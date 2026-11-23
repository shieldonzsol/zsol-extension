/**
 * Why a typed amount isn't one: nothing typed, not a number, a comma where a decimal point goes
 * ("1,5" would otherwise pay 15), more decimals than the token has, or zero.
 */
export type AmountProblem = "empty" | "not-amount" | "comma" | "decimals" | "zero";

export type TypedAmount =
  | { readonly ok: true; readonly amount: bigint }
  | { readonly ok: false; readonly problem: AmountProblem };

/** Thousands commas in groups of three: the only comma an amount takes. */
const GROUPED = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;

/** A decimal amount as typed ("1.5", ".5", "1,500.25") in the token's smallest unit. */
export function readAmount(text: string, decimals: number): TypedAmount {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, problem: "empty" };
  let plain = trimmed;
  if (trimmed.includes(",")) {
    if (!GROUPED.test(trimmed)) {
      return /^[\d.,]+$/.test(trimmed)
        ? { ok: false, problem: "comma" }
        : { ok: false, problem: "not-amount" };
    }
    plain = trimmed.replaceAll(",", "");
  }
  const match = /^(\d*)(?:\.(\d*))?$/.exec(plain);
  if (!match) return { ok: false, problem: "not-amount" };
  const [, whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return { ok: false, problem: "not-amount" };
  if (fraction.length > decimals) return { ok: false, problem: "decimals" };
  const amount = BigInt((whole || "0") + fraction.padEnd(decimals, "0"));
  return amount > 0n ? { ok: true, amount } : { ok: false, problem: "zero" };
}

/** An amount as a field takes it back: digits and one point, no thousands commas. */
export function plainAmount(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = (amount / base).toString();
  const fraction = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** The largest amount that, with its fee on top, fits in what is held. */
export function mostWithFee(held: bigint, feeOf: (amount: bigint) => bigint): bigint {
  let low = 0n;
  let high = held > 0n ? held : 0n;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    if (middle + feeOf(middle) <= held) low = middle;
    else high = middle - 1n;
  }
  return low;
}

const BPS = 10_000n;

/**
 * A fee of `bps` basis points on `amount`, rounded up so a fee that is owed is never zero, and
 * never under `minimum`. Nothing is owed on nothing.
 */
export function feeAt(amount: bigint, bps: bigint, minimum = 0n): bigint {
  if (amount <= 0n) return 0n;
  const fee = bps <= 0n ? 0n : (amount * bps + BPS - 1n) / BPS;
  return fee < minimum ? minimum : fee;
}

/** Basis points as a percentage people read: 10 is "0.1%". */
export function percentOf(bps: bigint): string {
  return `${String(Number(bps) / 100)}%`;
}
