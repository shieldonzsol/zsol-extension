// A ghost wallet's swap, once checked: signed here with the ghost wallet's own key, sent through
// zSol's gateway, and waited for. A send the chain refused before it left moved nothing; one
// whose answer was lost may have gone out.
import {
  assertIsFullySignedTransaction,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  isSolanaError,
  partiallySignTransaction,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type Transaction,
} from "@solana/kit";

import type { SubmitHooks } from "@/features/action/engine";
import { SendUnanswered, SendUnconfirmed, SponsorRefused } from "@/features/action/send-errors";
import type { SprClient } from "@/features/rings/client";

/** Solana refused it before it left: it failed in the gateway's simulation. Nothing moved. */
export class GhostSendRefused extends Error {
  override readonly name = "GhostSendRefused";
}

function httpStatusOf(error: unknown): number | null {
  if (!isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) return null;
  const status: unknown = Reflect.get(error.context, "statusCode");
  return typeof status === "number" ? status : null;
}

export async function sendFromGhost(input: {
  readonly client: Pick<SprClient, "solanaRpc" | "confirmTransaction">;
  readonly keys: CryptoKeyPair;
  readonly transaction: Transaction;
  readonly hooks: SubmitHooks;
}): Promise<string> {
  const { client, hooks } = input;
  hooks.onStep("signing");
  const signed = await partiallySignTransaction([input.keys], input.transaction);
  assertIsFullySignedTransaction(signed);
  const signature = getSignatureFromTransaction(signed);
  hooks.onSigned(signature);
  hooks.onStep("sending");
  try {
    await client.solanaRpc
      .sendTransaction(getBase64EncodedWireTransaction(signed), {
        encoding: "base64",
        preflightCommitment: "confirmed",
      })
      .send({ abortSignal: AbortSignal.timeout(30_000) });
  } catch (cause) {
    if (
      isSolanaError(cause, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)
    ) {
      throw new GhostSendRefused("Solana refused the swap before it went out.", { cause });
    }
    const status = httpStatusOf(cause);
    if (status === 401) throw new SponsorRefused("signed-out");
    if (status === 429) throw new SponsorRefused("busy");
    if (status !== null && status < 500) {
      throw new GhostSendRefused("zSol's gateway refused the swap.", { cause });
    }
    throw new SendUnanswered("The swap's answer never arrived.", { cause });
  }
  hooks.onSent(signature);
  hooks.onStep("confirming");
  await client.confirmTransaction(signature).catch((cause: unknown) => {
    throw new SendUnconfirmed(signature, { cause });
  });
  return signature;
}
