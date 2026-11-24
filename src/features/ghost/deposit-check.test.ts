import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { describe, expect, it } from "vitest";

import { depositShape, DepositRefused, POOL_PROGRAM } from "./deposit-check";

const OWN = address("GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB");
const OTHER = address("KdoNLUukCVa2jKqGhur5QWVe8FFeui4xUzwodWxZet7");
const TREE = address("3Dt7hkTp2AKev2KELvZgGrttNiNonwSJSTVGS1Ye1xem");

const deposit = (signer: Address): Instruction => ({
  programAddress: address(POOL_PROGRAM),
  accounts: [
    { address: signer, role: AccountRole.WRITABLE_SIGNER },
    { address: TREE, role: AccountRole.WRITABLE },
  ],
  data: new Uint8Array([1, 2, 3]),
});

const budget: Instruction = {
  programAddress: address("ComputeBudget111111111111111111111111111111"),
  data: new Uint8Array([2, 0, 0, 0, 0]),
};

const built = (payer: Address, instructions: Instruction[]) =>
  compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (message) => setTransactionMessageFeePayer(payer, message),
      (message) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: blockhash("11111111111111111111111111111111"), lastValidBlockHeight: 0n },
          message,
        ),
      (message) => appendTransactionMessageInstructions(instructions, message),
    ),
  );

const verdict = (run: () => void) => {
  try {
    run();
    return "passed";
  } catch (error) {
    return error instanceof DepositRefused ? error.message : String(error);
  }
};

describe("the deposit zSol's server built, before the private key signs it", () => {
  it("passes the pool's program once, paid and signed by the zSol address alone", () => {
    expect(verdict(() => depositShape(built(OWN, [budget, deposit(OWN)]), OWN))).toBe("passed");
  });

  it("refuses another payer, another signer, a second deposit or anything else", () => {
    expect(verdict(() => depositShape(built(OTHER, [deposit(OTHER)]), OWN))).toBe(
      "The deposit isn't paid by the zSol address.",
    );
    expect(verdict(() => depositShape(built(OWN, [deposit(OWN), deposit(OTHER)]), OWN))).toBe(
      "Someone else would sign the deposit.",
    );
    expect(verdict(() => depositShape(built(OWN, [deposit(OWN), deposit(OWN)]), OWN))).toBe(
      "The deposit doesn't run the pool once.",
    );
    const sends = getTransferSolInstruction({
      source: createNoopSigner(OWN),
      destination: OTHER,
      amount: 1n,
    });
    expect(verdict(() => depositShape(built(OWN, [deposit(OWN), sends]), OWN))).toBe(
      "The deposit runs more than the pool.",
    );
  });
});
