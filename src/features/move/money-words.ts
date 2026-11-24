import { formatAmount } from "@/features/rings/amounts";
import { WALLET_ASSETS } from "@/features/rings/holdings";
import type { PublicMoney, PublicToken, StayReason } from "@/features/rings/sweep";

export interface MoneyLine {
  readonly key: string;
  readonly amount: string;
  readonly symbol: string;
  /** A token's mint, when it has no name here. */
  readonly mint?: string;
}

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

export function tokenLine(token: PublicToken): MoneyLine {
  const known = WALLET_ASSETS.find((asset) => asset.mint === token.mint);
  return {
    key: token.account,
    amount: formatAmount(token.amount, token.decimals),
    ...(token.wrapped
      ? { symbol: "Wrapped SOL" }
      : known
        ? { symbol: known.symbol }
        : { symbol: short(token.mint), mint: token.mint }),
  };
}

/** What the address holds, as people read it: SOL first, then each token with an amount. */
export function moneyLines(money: PublicMoney): MoneyLine[] {
  return [
    ...(money.lamports > 0n
      ? [{ key: "sol", amount: formatAmount(money.lamports, 9), symbol: "SOL" }]
      : []),
    ...money.tokens.filter((token) => token.amount > 0n).map(tokenLine),
  ];
}

/** "0.05 SOL", "0.05 SOL and 12 USDC", "0.05 SOL and 2 tokens". */
export function summaryOf(lines: readonly MoneyLine[]): string {
  const [first, ...rest] = lines;
  if (!first) return "";
  const head = `${first.amount} ${first.symbol}`;
  if (rest.length === 0) return head;
  if (rest.length === 1) return `${head} and ${rest[0]!.amount} ${rest[0]!.symbol}`;
  return `${head} and ${String(rest.length)} tokens`;
}

export const STAY_WORDS: Record<StayReason, string> = {
  "new-to-rings": "The private pool doesn't take this token yet.",
  frozen: "Its issuer froze this account, so it can't move.",
  fails: "Its deposit into the private pool fails, so it stays.",
};
