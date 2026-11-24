import { describe, expect, it } from "vitest";

import { failedInstructionOf, sweepFlow, sweepSplit, SweepTooSmall } from "./sweep";

const RESERVE = 890_880n;
const SELF_FEE = 15_000n;

describe("who pays a move's network fee", () => {
  it("is the address itself when it keeps its reserve after the fee", () => {
    expect(
      sweepFlow({
        lamports: 10_000_000n,
        reserve: RESERVE,
        registryRent: null,
        closed: 0n,
        selfFee: SELF_FEE,
      }),
    ).toEqual({ flowing: 10_000_000n, selfPaid: true });
  });

  it("is zSol, paid back, when the fee would take the address below its reserve", () => {
    expect(
      sweepFlow({
        lamports: RESERVE,
        reserve: RESERVE,
        registryRent: null,
        closed: 2_039_280n,
        selfFee: SELF_FEE,
      }),
    ).toEqual({ flowing: RESERVE + 2_039_280n, selfPaid: false });
  });

  it("counts the record's rent out and closed accounts' rent in", () => {
    const { flowing } = sweepFlow({
      lamports: 5_000_000n,
      reserve: RESERVE,
      registryRent: 1_586_880n,
      closed: 2_039_280n,
      selfFee: SELF_FEE,
    });
    expect(flowing).toBe(5_000_000n - 1_586_880n + 2_039_280n);
  });

  it("is zSol when only token accounts' rent moves", () => {
    expect(
      sweepFlow({
        lamports: 0n,
        reserve: RESERVE,
        registryRent: null,
        closed: 2_039_280n,
        selfFee: SELF_FEE,
      }).selfPaid,
    ).toBe(false);
  });
});

describe("what a move hands back and puts in", () => {
  it("takes the fee from the SOL when the address pays", () => {
    expect(sweepSplit({ flowing: 1_000_000n, selfPaid: true, fee: SELF_FEE })).toEqual({
      paysBack: 0n,
      sol: 985_000n,
      paid: SELF_FEE,
    });
  });

  it("hands zSol back exactly the fee it fronted", () => {
    expect(sweepSplit({ flowing: 1_000_000n, selfPaid: false, fee: 20_000n })).toEqual({
      paysBack: 20_000n,
      sol: 980_000n,
      paid: 20_000n,
    });
  });

  it("refuses SOL smaller than the fee it must hand back", () => {
    expect(() => sweepSplit({ flowing: 12_000n, selfPaid: false, fee: 20_000n })).toThrow(
      SweepTooSmall,
    );
  });

  it("leaves the fee fronted only when no SOL moves at all", () => {
    expect(sweepSplit({ flowing: 0n, selfPaid: false, fee: 20_000n })).toEqual({
      paysBack: 0n,
      sol: 0n,
      paid: 0n,
    });
  });
});

describe("the instruction a simulation failed at", () => {
  it("reads it as a number or a bigint", () => {
    expect(failedInstructionOf({ InstructionError: [3, { Custom: 1 }] })).toBe(3);
    expect(failedInstructionOf({ InstructionError: [2n, "InvalidAccountData"] })).toBe(2);
  });

  it("is null when the failure names none", () => {
    expect(failedInstructionOf("AccountNotFound")).toBeNull();
    expect(failedInstructionOf({ InsufficientFundsForRent: { account_index: 0 } })).toBeNull();
  });
});
