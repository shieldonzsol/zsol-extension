import { address, AccountRole } from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  checkedSwap,
  swapInstructionsForKit,
  routeTrade,
  solSideOf,
  tradeAmounts,
  tradeCosts,
  TradeError,
  venueNamingFeePayer,
  WRAPPED_SOL_MINT,
  type SwapInstruction,
  type TradeSwap,
} from "./trade";
import { tradeFee } from "./trade-fees";

const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const TRADER = address("7ER5T7HvMjbfHKDb5ksMrqLNP8vurTtVJpt1rW8ATyax");
const FEES = address("5NtkdbTTkyVTLzVZbqu12oZVFzAQQgXiLiQGuJuHMvhc");
const STRANGER = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const RESERVE = 650_240n;

const meta = (at: string, signer = false, writable = false) => ({
  address: at,
  signer,
  writable,
});

/** Creating the trader's token account, zSol's fee wallet paying (Jupiter's setup with `payer`). */
const createAccount: SwapInstruction = {
  programAddress: ATA_PROGRAM,
  accounts: [
    meta(FEES, true, true),
    meta("HxC1iJTPFXG6aFrfQg2xBYz2m7FLrcWSWcVTArpjJezE", false, true),
    meta(TRADER),
    meta(USDC),
  ],
  data: Uint8Array.of(1),
};
const swapStep: SwapInstruction = {
  programAddress: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  accounts: [meta("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), meta(TRADER, true)],
  data: Uint8Array.of(7, 7),
};

const buy = (instructions: readonly SwapInstruction[] = [createAccount, swapStep]) =>
  ({
    inputMint: WRAPPED_SOL_MINT,
    outputMint: USDC,
    inAmount: 3_000_000n,
    minOutAmount: 243_196n,
    instructions,
  }) satisfies TradeSwap;
const sell: TradeSwap = {
  inputMint: USDC,
  outputMint: WRAPPED_SOL_MINT,
  inAmount: 243_196n,
  minOutAmount: 2_980_000n,
  instructions: [swapStep],
};

const BONK = address("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
const WIF = address("EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm");
const swapOfTokens: TradeSwap = {
  inputMint: BONK,
  outputMint: WIF,
  inAmount: 1_000_000_00000n,
  minOutAmount: 1_234_567n,
  instructions: [swapStep],
};

const empty = { lamports: 0n, inputTokens: 0n, outputTokens: 0n, reserve: RESERVE };
const free = { fee: 0n, rentFronted: 0n, rentRefunded: 0n };
const TOKEN_RENT = 2_039_280n;
const codeOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof TradeError ? error.code : "other";
  }
  return "passed";
};

describe("checkedSwap", () => {
  const parties = { trader: TRADER, feePayer: FEES };

  it("passes the trader signing the swap and zSol's fee wallet paying its token account", () => {
    expect(codeOf(() => checkedSwap(buy(), parties))).toBe("passed");
  });

  it("refuses a signer other than the trader and zSol's fee wallet", () => {
    const foreign = { ...swapStep, accounts: [meta(STRANGER, true)] };
    expect(codeOf(() => checkedSwap(buy([foreign]), parties))).toBe("foreign-signer");
  });

  it("refuses zSol's fee wallet signing anything but the trader's token account", () => {
    const spends = {
      ...swapStep,
      accounts: [meta(FEES, true, true), meta(TRADER, true)],
    };
    expect(codeOf(() => checkedSwap(buy([spends]), parties))).toBe("fee-payer-spend");
    // Named without signing (a venue taking Jupiter's payer inside the swap): zSol's fee wallet
    // signs the transaction, so the venue could still spend from it.
    const named = {
      ...swapStep,
      accounts: [meta(FEES, false, true), meta(TRADER, true)],
    };
    expect(codeOf(() => checkedSwap(buy([named]), parties))).toBe("fee-payer-spend");
    const forSomeoneElse = {
      ...createAccount,
      accounts: createAccount.accounts.map((account, at) => (at === 2 ? meta(STRANGER) : account)),
    };
    expect(codeOf(() => checkedSwap(buy([forSomeoneElse]), parties))).toBe("fee-payer-spend");
  });

  it("refuses a compute budget and a swap of a token for itself", () => {
    const budget = {
      programAddress: "ComputeBudget111111111111111111111111111111",
      accounts: [],
      data: Uint8Array.of(2),
    };
    expect(codeOf(() => checkedSwap(buy([budget]), parties))).toBe("compute-budget");
    expect(codeOf(() => checkedSwap({ ...buy(), outputMint: WRAPPED_SOL_MINT }, parties))).toBe(
      "same-token",
    );
  });
});

describe("tradeAmounts", () => {
  it("buys: withdraws the SOL in, deposits the minimum out", () => {
    expect(tradeAmounts(buy(), empty, free)).toEqual({
      ...free,
      withdraw: 3_000_000n,
      withdrawSol: 0n,
      deposit: 243_196n,
    });
  });

  it("spends the trader's spare SOL and sweeps the tokens left by an earlier trade", () => {
    expect(
      tradeAmounts(
        buy(),
        {
          ...empty,
          lamports: RESERVE + 1_000n,
          outputTokens: 1_222n,
        },
        free,
      ),
    ).toEqual({ ...free, withdraw: 2_999_000n, withdrawSol: 0n, deposit: 244_418n });
  });

  it("sells: keeps the trader's rent reserve out of its first SOL", () => {
    expect(tradeAmounts(sell, empty, free)).toEqual({
      ...free,
      withdraw: 243_196n,
      withdrawSol: 0n,
      deposit: 2_980_000n - RESERVE,
    });
    // Once it holds the reserve, the whole minimum and any surplus go back.
    expect(tradeAmounts(sell, { ...empty, lamports: RESERVE + 15_000n }, free)).toEqual({
      ...free,
      withdraw: 243_196n,
      withdrawSol: 0n,
      deposit: 2_995_000n,
    });
  });

  it("refuses a sale paying less than the reserve, and a trade with nothing to withdraw", () => {
    expect(codeOf(() => tradeAmounts({ ...sell, minOutAmount: RESERVE }, empty, free))).toBe(
      "too-small",
    );
    expect(codeOf(() => tradeAmounts(sell, { ...empty, inputTokens: 243_196n }, free))).toBe(
      "nothing-to-withdraw",
    );
  });
});

describe("zSol's 1%, always in SOL", () => {
  it("is 1% rounded up to the lamport", () => {
    expect(tradeFee(3_000_000n)).toBe(30_000n);
    expect(tradeFee(3_000_001n)).toBe(30_001n);
    expect(tradeFee(0n)).toBe(0n);
  });

  it("counts on the SOL that goes in, or the least that comes out", () => {
    expect(solSideOf(buy())).toBe(3_000_000n);
    expect(solSideOf(sell)).toBe(2_980_000n);
    expect(solSideOf(swapOfTokens)).toBeNull();
  });

  it("prices a trade with no SOL side from a quote, and refuses one without", () => {
    const rent = { fronted: 0n, refunded: 0n };
    expect(tradeCosts(swapOfTokens, rent, 200_000_000n).fee).toBe(2_000_000n);
    expect(tradeCosts(buy(), rent, 1n).fee).toBe(30_000n);
    expect(codeOf(() => tradeCosts(swapOfTokens, rent))).toBe("no-sol-value");
  });
});

describe("tradeAmounts with zSol's fee and the rent", () => {
  it("buys with SOL: withdraws the fee and a new token account's rent with the SOL in", () => {
    // zSol's fee wallet fronts wrapped SOL's account (refunded when the swap closes it) and the
    // trader's new USDC account; the trader pays the fee and keeps the USDC account.
    const costs = tradeCosts(buy(), { fronted: 2n * TOKEN_RENT, refunded: TOKEN_RENT });
    expect(tradeAmounts(buy(), empty, costs)).toEqual({
      fee: 30_000n,
      rentFronted: 2n * TOKEN_RENT,
      rentRefunded: TOKEN_RENT,
      withdraw: 3_000_000n + 30_000n + TOKEN_RENT,
      withdrawSol: 0n,
      deposit: 243_196n,
    });
  });

  it("sells for SOL: pays the fee out of the SOL before depositing it", () => {
    const costs = tradeCosts(sell, { fronted: TOKEN_RENT, refunded: TOKEN_RENT });
    expect(tradeAmounts(sell, { ...empty, lamports: RESERVE }, costs)).toMatchObject({
      fee: 29_800n,
      withdraw: 243_196n,
      withdrawSol: 0n,
      deposit: 2_980_000n - 29_800n,
    });
  });

  it("trades a token for a token: withdraws SOL for the fee and rent too, less spare SOL", () => {
    const costs = tradeCosts(swapOfTokens, { fronted: TOKEN_RENT, refunded: 0n }, 200_000_000n);
    expect(tradeAmounts(swapOfTokens, empty, costs)).toMatchObject({
      withdraw: 1_000_000_00000n,
      withdrawSol: 2_000_000n + TOKEN_RENT,
      deposit: 1_234_567n,
    });
    // Leftover SOL above the reserve pays first; the trader keeps its reserve.
    expect(
      tradeAmounts(swapOfTokens, { ...empty, lamports: RESERVE + 500_000n }, costs),
    ).toMatchObject({ withdrawSol: 1_500_000n + TOKEN_RENT });
    expect(
      tradeAmounts(swapOfTokens, { ...empty, lamports: RESERVE + 9_000_000n }, costs),
    ).toMatchObject({ withdrawSol: 0n });
  });

  it("refuses a sale whose SOL does not cover the fee, the rent and the reserve", () => {
    const costs = tradeCosts(sell, { fronted: 0n, refunded: 0n });
    expect(
      codeOf(() =>
        tradeAmounts({ ...sell, minOutAmount: RESERVE + 6_000n }, empty, {
          ...costs,
          fee: 6_000n,
        }),
      ),
    ).toBe("too-small");
  });
});

describe("swapInstructionsForKit", () => {
  it("keeps every account's role and the data", () => {
    const [create, swap] = swapInstructionsForKit(buy());
    expect(create!.accounts!.map((account) => account.role)).toEqual([
      AccountRole.WRITABLE_SIGNER,
      AccountRole.WRITABLE,
      AccountRole.READONLY,
      AccountRole.READONLY,
    ]);
    expect(swap!.accounts![1]).toEqual({
      address: TRADER,
      role: AccountRole.READONLY_SIGNER,
    });
    expect(swap!.data).toEqual(Uint8Array.of(7, 7));
  });
});

describe("routeTrade", () => {
  const VENUE = "MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms";
  const naming: SwapInstruction = {
    ...swapStep,
    accounts: [meta(VENUE), meta(FEES, false, true), meta(TRADER, true)],
  };
  const labels = new Map([[VENUE, "Manifest"]]);

  it("finds the venue whose swap names zSol's fee wallet", () => {
    expect(venueNamingFeePayer(buy([createAccount, naming]), FEES, labels)).toBe("Manifest");
    expect(venueNamingFeePayer(buy(), FEES, labels)).toBeNull();
  });

  it("asks again with fewer accounts when too large, and without a venue naming zSol's fee wallet", async () => {
    const asks: { maxAccounts: number; excludeDexes: readonly string[] }[] = [];
    const built = await routeTrade({
      feePayer: FEES,
      labels: () => Promise.resolve(labels),
      ask: (ask) => {
        asks.push({ ...ask, excludeDexes: [...ask.excludeDexes] });
        return Promise.resolve(asks.length === 2 ? buy([naming]) : buy());
      },
      build: (swap) => {
        if (asks.length === 1) {
          return Promise.reject(new TradeError("too-large", "too large"));
        }
        checkedSwap(swap, { trader: TRADER, feePayer: FEES });
        return Promise.resolve("built");
      },
    });
    expect(built).toBe("built");
    expect(asks).toEqual([
      { maxAccounts: 28, excludeDexes: [] },
      { maxAccounts: 22, excludeDexes: [] },
      { maxAccounts: 22, excludeDexes: ["Manifest"] },
    ]);
  });

  it("gives up when no route is small enough", async () => {
    const refused = await routeTrade({
      feePayer: FEES,
      labels: () => Promise.resolve(labels),
      ask: () => Promise.resolve(buy()),
      build: () => Promise.reject(new TradeError("too-large", "too large")),
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(TradeError);
  });
});
