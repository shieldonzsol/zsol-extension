import { address, blockhash, type Address } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { checkGhostSwap, ghostSwapTransaction, GhostSwapRefused } from "./ghost-swap";
import type { TradeSwap } from "./trade";

const JUPITER_PROGRAMS = { swapV6: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" };
const SOLANA_TOKEN_PROGRAMS = {
  token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
};

const GHOST = address("27ECaFtYn3u6fvJhwhco7vDweoupmVTMUHSccDaD6be5");
const COSIGNER = address("Fees111111111111111111111111111111111111111");
const TREASURY = address("6py5nneyB85G1hs6txhZENCgwXa2kLb3yKufGHgfwiUE");
const WRAPPED = address("9xdj8MebDN7WbT4pmvqdP2HoH8yaJ3t7xVHBNVvx9M9c");
const THIEF = address("6Xe5j5w9gxNYEh1znBUjQEQZkgW1NDToBF4xGQLATqVq");
const WSOL = address("So11111111111111111111111111111111111111112");
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const lifetime = {
  blockhash: blockhash("11111111111111111111111111111111"),
  lastValidBlockHeight: 0n,
};

/** A buy of USDC with 0.1 SOL as Jupiter builds it for the ghost wallet: wrap, swap, unwrap. */
const meta = (at: Address, signer = false, writable = true) => ({
  address: at,
  signer,
  writable,
});

const swap = (extra: TradeSwap["instructions"] = []): TradeSwap => {
  return {
    inputMint: WSOL,
    outputMint: USDC,
    inAmount: 100_000_000n,
    minOutAmount: 7_000_000n,
    instructions: [
      {
        programAddress: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
        accounts: [meta(GHOST, true), meta(WRAPPED), meta(GHOST, false, false), meta(WSOL)],
        data: new Uint8Array([1]),
      },
      {
        programAddress: "11111111111111111111111111111111",
        accounts: [meta(GHOST, true), meta(WRAPPED)],
        data: new Uint8Array([2, 0, 0, 0, 0, 225, 245, 5, 0, 0, 0, 0]),
      },
      {
        programAddress: SOLANA_TOKEN_PROGRAMS.token,
        accounts: [meta(WRAPPED)],
        data: new Uint8Array([17]),
      },
      {
        programAddress: JUPITER_PROGRAMS.swapV6,
        accounts: [meta(GHOST, true, false), meta(WRAPPED)],
        data: new Uint8Array([1, 2, 3]),
      },
      ...extra,
    ],
  };
};

const built = (fee = 1_500_000n, extra: TradeSwap["instructions"] = [], priority = 10_000n) =>
  ghostSwapTransaction({
    ghost: GHOST,
    cosigner: COSIGNER,
    feeTo: TREASURY,
    fee,
    swap: swap(extra),
    lifetime,
    config: { computeUnitLimit: 800_000, priorityFeeLamports: priority },
  });

const expected = {
  ghost: GHOST,
  cosigner: COSIGNER,
  feeTo: new Set([TREASURY]),
  wrapped: WRAPPED,
  mostFee: 1_545_000n,
  mostPriorityFee: 10_000n,
};
const verdict = (run: () => unknown) => {
  try {
    run();
    return "passes";
  } catch (error) {
    return error instanceof GhostSwapRefused ? error.message : String(error);
  }
};

describe("a ghost wallet's swap, built and co-signed by zSol's server", () => {
  it("is paid by the ghost wallet and signed by it and zSol's fee wallet, zSol's fee in it", () => {
    const transaction = built();
    expect(Object.keys(transaction.signatures).toSorted()).toEqual([GHOST, COSIGNER].toSorted());
    expect(checkGhostSwap(transaction, expected)).toEqual({ fee: 1_500_000n });
  });

  it("is refused by the browser when it pays more than expected or anyone else", () => {
    expect(verdict(() => checkGhostSwap(built(1_600_000n), expected))).toBe(
      "zSol's fee is more than expected.",
    );
    expect(verdict(() => checkGhostSwap(built(1_500_000n, [], 50_000n), expected))).toBe(
      "The swap asks more priority fee than expected.",
    );
    // One lamport from the ghost wallet to someone else, hidden in the route.
    const theft = {
      programAddress: "11111111111111111111111111111111",
      accounts: [
        { address: GHOST, signer: true, writable: true },
        { address: THIEF, signer: false, writable: true },
      ],
      data: new Uint8Array([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
    };
    expect(verdict(() => checkGhostSwap(built(1_500_000n, [theft]), expected))).toBe(
      "SOL leaves the ghost wallet only for its swap and zSol's fee.",
    );
  });

  it("is refused when the route opens an account for someone else or names zSol's fee wallet", () => {
    const strangersAccount = {
      programAddress: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      accounts: [
        { address: GHOST, signer: true, writable: true },
        { address: WRAPPED, signer: false, writable: true },
        { address: THIEF, signer: false, writable: false },
      ],
      data: new Uint8Array([1]),
    };
    expect(verdict(() => checkGhostSwap(built(1_500_000n, [strangersAccount]), expected))).toBe(
      "Only the ghost wallet's own token accounts are opened.",
    );
    const namesCosigner = {
      programAddress: JUPITER_PROGRAMS.swapV6,
      accounts: [{ address: COSIGNER, signer: false, writable: true }],
      data: new Uint8Array([0]),
    };
    expect(verdict(() => checkGhostSwap(built(1_500_000n, [namesCosigner]), expected))).toBe(
      "The swap names zSol's fee wallet.",
    );
    const elsewhere = {
      programAddress: THIEF,
      accounts: [{ address: GHOST, signer: true, writable: true }],
      data: new Uint8Array([0]),
    };
    expect(verdict(() => checkGhostSwap(built(1_500_000n, [elsewhere]), expected))).toBe(
      `A ghost swap doesn't run ${THIEF}.`,
    );
  });
});
