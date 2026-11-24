import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";

import type { PublicToken } from "@/features/rings/sweep";

import { moneyLines, summaryOf, tokenLine } from "./money-words";

const token = (over: Partial<PublicToken>): PublicToken => ({
  mint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  account: address("3Dt7hkTp2AKev2KELvZgGrttNiNonwSJSTVGS1Ye1xem"),
  program: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  amount: 12_500_000n,
  decimals: 6,
  rent: 2_039_280n,
  frozen: false,
  wrapped: false,
  ...over,
});

describe("public money as people read it", () => {
  it("names known tokens, wrapped SOL, and shows others by their mint", () => {
    expect(tokenLine(token({}))).toMatchObject({ amount: "12.5", symbol: "USDC" });
    expect(
      tokenLine(
        token({
          mint: address("So11111111111111111111111111111111111111112"),
          wrapped: true,
          decimals: 9,
          amount: 5_000_000n,
        }),
      ),
    ).toMatchObject({ amount: "0.005", symbol: "Wrapped SOL" });
    const other = tokenLine(
      token({
        mint: address("CjGmj44FNunTsPBg28M3j4skJosYUtuYrYhULoNzGyHs"),
        decimals: 0,
        amount: 3n,
      }),
    );
    expect(other).toMatchObject({ amount: "3", symbol: "CjGm…GyHs" });
    expect(other.mint).toBe("CjGmj44FNunTsPBg28M3j4skJosYUtuYrYhULoNzGyHs");
  });

  it("lists SOL first and leaves empty accounts out", () => {
    const lines = moneyLines({
      owner: address("GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB"),
      lamports: 50_000_000n,
      reserve: 890_880n,
      tokens: [token({}), token({ amount: 0n })],
    });
    expect(lines.map((line) => `${line.amount} ${line.symbol}`)).toEqual(["0.05 SOL", "12.5 USDC"]);
  });

  it("sums up one, two or more holdings in a line", () => {
    const sol = { key: "sol", amount: "0.05", symbol: "SOL" };
    const usdc = { key: "u", amount: "12.5", symbol: "USDC" };
    expect(summaryOf([])).toBe("");
    expect(summaryOf([sol])).toBe("0.05 SOL");
    expect(summaryOf([sol, usdc])).toBe("0.05 SOL and 12.5 USDC");
    expect(summaryOf([sol, usdc, usdc])).toBe("0.05 SOL and 2 tokens");
  });
});
