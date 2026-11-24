// The deposit into Ghost Route is built by zSol's server, which holds the pool account's key; the
// private wallet's own key pays for it. Before that key signs, the panel checks it: the zSol
// address pays and is the only signer, it runs the pool's program and nothing else, and in a
// simulation it takes from the zSol address at least the plan's amount and no more than the
// plan left there.
import {
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  partiallySignTransactionWithSigners,
  assertIsFullySignedTransaction,
  type Address,
  type Transaction,
  type TransactionPartialSigner,
} from "@solana/kit";

import type { SprClient } from "@/features/rings/client";

/** The pool's program on Solana mainnet. */
export const POOL_PROGRAM = "9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";

export class DepositRefused extends Error {
  override readonly name = "DepositRefused";
}

const refuse = (message: string): never => {
  throw new DepositRefused(message);
};

/** The programs a compiled message runs, whatever its version. */
function programsOf(
  message: ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>,
) {
  const keys: readonly string[] = message.staticAccounts;
  return "instructionHeaders" in message
    ? message.instructionHeaders.map((header) => keys[header.programAccountIndex])
    : message.instructions.map((instruction) => keys[instruction.programAddressIndex]);
}

/** The deposit's shape: the zSol address pays and alone signs; the pool's program, once. */
export function depositShape(transaction: Pick<Transaction, "messageBytes">, payer: Address): void {
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  if (message.staticAccounts[0] !== payer) refuse("The deposit isn't paid by the zSol address.");
  if (message.header.numSignerAccounts !== 1) refuse("Someone else would sign the deposit.");
  const programs = programsOf(message);
  if (programs.filter((program) => program === POOL_PROGRAM).length !== 1) {
    refuse("The deposit doesn't run the pool once.");
  }
  if (programs.some((program) => program !== POOL_PROGRAM && program !== COMPUTE_BUDGET)) {
    refuse("The deposit runs more than the pool.");
  }
}

/**
 * Checks the deposit zSol's server built, then signs it with the private wallet's own key.
 * Returns the signed wire bytes, in base64.
 */
export async function checkedAndSigned(input: {
  readonly client: SprClient;
  readonly wire: string;
  readonly payer: TransactionPartialSigner;
  /** The plan's amount: the least the deposit must take. */
  readonly amount: bigint;
  /** What the plan left at the zSol address: the most the deposit may take. */
  readonly most: bigint;
}): Promise<string> {
  const { client, payer } = input;
  let transaction: Transaction;
  try {
    transaction = getTransactionDecoder().decode(getBase64Encoder().encode(input.wire));
  } catch {
    return refuse("The deposit couldn't be read.");
  }
  depositShape(transaction, payer.address);
  const [{ value: before }, { value: simulated }] = await Promise.all([
    client.solanaRpc.getBalance(payer.address, { commitment: "confirmed" }).send(),
    client.solanaRpc
      .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
        encoding: "base64",
        commitment: "confirmed",
        sigVerify: false,
        replaceRecentBlockhash: true,
        accounts: { addresses: [payer.address], encoding: "base64" },
      })
      .send(),
  ]);
  if (simulated.err) refuse("The deposit fails in simulation.");
  const after = simulated.accounts?.[0]?.lamports;
  if (after === undefined || after === null) refuse("The simulation didn't say what it takes.");
  const taken = before - BigInt(after ?? 0);
  if (taken < input.amount) refuse("The deposit takes less than the plan's amount.");
  if (taken > input.most) refuse("The deposit takes more than the plan left there.");
  const signed = await partiallySignTransactionWithSigners([payer], transaction);
  assertIsFullySignedTransaction(signed);
  return getBase64EncodedWireTransaction(signed);
}
