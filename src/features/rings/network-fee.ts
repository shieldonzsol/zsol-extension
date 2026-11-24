import type { SprClient } from "@heliuslabs/spr/client";
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64Decoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Transaction,
  type TransactionMessageBytesBase64,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

/** Solana's fee for one signature: a first guess, read again from the chain. */
export const SIGNATURE_FEE = 5_000n;

/** What Rings charges its fee payer for each transact. */
export const RINGS_TRANSACT_FEE = 5_000n;

/** The network fee the chain asks for `transaction`'s very message, in lamports. */
export async function networkFeeOf(client: SprClient, transaction: Transaction): Promise<bigint> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the message's own bytes.
  const message = getBase64Decoder().decode(
    transaction.messageBytes,
  ) as TransactionMessageBytesBase64;
  const { value } = await client.solanaRpc.getFeeForMessage(message).send();
  if (value === null) throw new Error("The chain didn't price the transaction's message.");
  return BigInt(value);
}

/**
 * The network fee of a transaction `feePayer` and one spender sign, priced by the chain on a
 * stand-in message: a proof is made once, so what it costs must be known before.
 */
export async function twoSignerFee(
  client: SprClient,
  feePayer: Address,
  spender: Address,
): Promise<bigint> {
  const { value: lifetime } = await client.solanaRpc.getLatestBlockhash().send();
  const standIn = compileTransaction(
    pipe(
      createTransactionMessage({ version: 1 }),
      (message) => setTransactionMessageFeePayer(feePayer, message),
      (message) => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
      (message) =>
        appendTransactionMessageInstructions(
          [
            getTransferSolInstruction({
              source: createNoopSigner(spender),
              destination: feePayer,
              amount: 0n,
            }),
          ],
          message,
        ),
    ),
  );
  return networkFeeOf(client, standIn);
}
