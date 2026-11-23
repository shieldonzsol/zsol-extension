/** The exact amount: every decimal it has, trailing zeros cut. */
export function formatAmount(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const units = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = (units / base).toLocaleString("en-US");
  const fraction = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * An amount as a card shows it: at most `places` decimals, rounded down so it never shows more
 * than there is. Dust below the last place reads "<0.0001", never 0.
 */
export function formatShown(amount: bigint, decimals: number, places: number): string {
  const kept = Math.max(0, Math.min(places, decimals));
  const step = 10n ** BigInt(decimals - kept);
  const negative = amount < 0n;
  const units = negative ? -amount : amount;
  const rounded = units / step;
  if (units > 0n && rounded === 0n) return `${negative ? "-" : ""}<0.${"0".repeat(kept - 1)}1`;
  return formatAmount(negative ? -rounded : rounded, kept);
}

/** An amount said as "about": rounded to the nearest at `places` decimals. */
export function formatAbout(amount: bigint, decimals: number, places: number): string {
  const kept = Math.max(0, Math.min(places, decimals));
  const step = 10n ** BigInt(decimals - kept);
  return formatAmount((amount + step / 2n) / step, kept);
}
