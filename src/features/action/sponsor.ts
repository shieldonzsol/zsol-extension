// A private send through zSol's fee wallet: signed here by the private wallet, the keys zSol's
// fee wallet checks with worked out here, then zSol checks every output to someone else,
// screens every address, pays the network fee, sends and waits. The private wallet then reads
// it back. A lost answer or a send not seen landing is never read as "nothing moved".
import {
  getBase58Decoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  partiallySignTransactionWithSigners,
  signature as toSignature,
  type Signature,
  type Transaction,
} from "@solana/kit";

import { authHeaders } from "@/features/auth/auth-source";
import { siteFetch, type SprClient } from "@/features/rings/client";
import { sponsorKeys, type Spender } from "@/features/rings/sponsor-keys";

export {
  DEFAULT_SEND_FEE_BPS,
  DEFAULT_TRADE_FEE_MINIMUM,
  MAX_SEND_FEE_BPS,
  MAX_SEND_FEE_MINIMUMS,
  MAX_TRADE_FEE_MINIMUM,
  readSetup,
  SetupUnread,
  sponsorSetup,
  type SponsorSetup,
} from "./sponsor-setup";

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null ? Reflect.get(body, name) : undefined;
}

export {
  SendUnanswered,
  SendUnconfirmed,
  SponsorRefused,
  SyncBehind,
  type SponsorBudget,
} from "./send-errors";
import {
  budgetIn,
  SendUnanswered,
  SendUnconfirmed,
  SponsorRefused,
  SyncBehind,
} from "./send-errors";

export type SendStep =
  /** Signed here; the keys zSol's fee wallet checks with worked out. */
  | "signing"
  /** zSol checks it, pays the network fee and sends it. */
  | "sending"
  /** Waiting for it to land. */
  | "confirming"
  /** It landed: the private wallet reads it in. */
  | "syncing";

/** zSol's fee wallet checks, signs, sends and waits within this; past it the answer is lost. */
const SPONSOR_ANSWER_MS = 60_000;

const base64 = (bytes: Uint8Array) => getBase64Decoder().decode(bytes);

/**
 * How zSol takes it: a private action, its outputs to others opened with the keys handed over;
 * or a move into the private balance or a trade, which pay nobody privately.
 */
export type SponsorKind = "private" | "sweep" | "trade";

export async function submitSponsored(input: {
  readonly site: string;
  readonly client: SprClient;
  readonly spender: Spender;
  readonly transaction: Transaction;
  readonly kind?: SponsorKind;
  readonly onStep: (step: SendStep) => void;
  /** The private wallet signed it: its own signature, before anything is sent. */
  readonly onSigned?: (signature: string) => void;
  /** zSol sent it: the transaction's signature. */
  readonly onSent?: (signature: string) => void;
  /** Reads the private wallet again once the send landed at `slot`. */
  readonly readBack: (slot: bigint) => Promise<void>;
}): Promise<Signature> {
  input.onStep("signing");
  const signed = await partiallySignTransactionWithSigners(
    [input.spender.keypair.toSolanaSigner()],
    input.transaction,
  );
  const own = signed.signatures[input.spender.keypair.shieldedAddress().solanaAddress()];
  if (own) input.onSigned?.(getBase58Decoder().decode(own));
  const body = await bodyOf(input.kind ?? "private", input.client, input.spender, signed);
  input.onStep("sending");
  const auth = await authHeaders();
  if (!auth) throw new SponsorRefused("signed-out");
  const response = await siteFetch(input.site)(`${input.site}/api/sponsor`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(SPONSOR_ANSWER_MS),
  }).catch((cause: unknown) => {
    throw new SendUnanswered("zSol's answer never arrived.", { cause });
  });
  const answer: unknown = await response.json().catch(() => null);
  const signature = field(answer, "signature");
  if (!response.ok || typeof signature !== "string") {
    const code = field(answer, "error");
    const wait = field(answer, "retryAfterSeconds");
    throw new SponsorRefused(
      response.status === 429 ? "busy" : typeof code === "string" ? code : "failed",
      typeof wait === "number" ? wait : undefined,
      budgetIn(answer),
    );
  }
  const sent = toSignature(signature);
  input.onSent?.(sent);
  input.onStep("confirming");
  const slot = await input.client.confirmTransaction(sent).catch((cause: unknown) => {
    throw new SendUnconfirmed(sent, { cause });
  });
  input.onStep("syncing");
  await input.readBack(slot).catch((cause: unknown) => {
    throw new SyncBehind(sent, { cause });
  });
  return sent;
}

async function bodyOf(
  kind: SponsorKind,
  client: SprClient,
  spender: Spender,
  signed: Transaction,
): Promise<string> {
  const transaction = getBase64EncodedWireTransaction(signed);
  if (kind !== "private") return JSON.stringify({ kind, transaction });
  const keys = await sponsorKeys(client, spender, signed);
  try {
    return JSON.stringify({
      transaction,
      txViewingKey: base64(keys.txViewingKey),
      receivers: keys.receivers.map((receiver) => ({
        slot: receiver.slot,
        asset: receiver.asset,
        nullifierPublicKey: base64(receiver.nullifierPublicKey),
      })),
    });
  } finally {
    keys.txViewingKey.fill(0);
  }
}

export type Landed = "landed" | "unsynced" | "failed" | "pending";

/** How long one check waits for the chain before it answers "not yet". */
const CHECK_MS = 15_000;

/** Asks again whether a sent transaction landed, and reads it in when it did. */
export async function checkLanded(
  client: SprClient,
  signature: string,
  readBack: (slot: bigint) => Promise<void>,
): Promise<Landed> {
  let slot: bigint;
  try {
    slot = await client.confirmTransaction(toSignature(signature), undefined, {
      signal: AbortSignal.timeout(CHECK_MS),
    });
  } catch (error) {
    return landedOf(error);
  }
  try {
    await readBack(slot);
    return "landed";
  } catch {
    return "unsynced";
  }
}

/** What a failed confirmation says: it failed on chain, or it may still land. */
export function landedOf(cause: unknown): "failed" | "pending" {
  const details =
    typeof cause === "object" && cause !== null ? Reflect.get(cause, "details") : null;
  const reason =
    typeof details === "object" && details !== null ? Reflect.get(details, "reason") : null;
  return reason === "transaction failed" ? "failed" : "pending";
}
