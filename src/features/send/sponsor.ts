// A private send through zSol's fee wallet: signed here by the private wallet, the keys zSol's
// fee wallet checks with worked out here, then zSol checks every output to someone else,
// screens every address, pays the network fee, sends and waits. The private wallet then reads
// it back. A lost answer or a send not seen landing is never read as "nothing moved".
import {
  address,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  partiallySignTransactionWithSigners,
  signature as toSignature,
  type Address,
  type Signature,
  type Transaction,
} from "@solana/kit";

import { authHeaders } from "@/features/privy/auth-headers";
import { siteFetch, type SprClient } from "@/features/rings/client";
import { sponsorKeys, type Spender } from "@/features/rings/sponsor-keys";

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface SponsorSetup {
  readonly feePayer: Address;
  readonly treasury: Address;
  /** The tokens a send pays zSol's fee in. */
  readonly feeAssets: ReadonlySet<string>;
  /** zSol's fee on a send, in basis points, as zSol states it now. */
  readonly sendFeeBps: bigint;
  /** Null when private actions can run now; otherwise why they can't. */
  readonly paused: "fee-wallet" | "treasury" | "off" | null;
}

/** zSol's fee on a send when it doesn't state one: 0.1%. */
export const DEFAULT_SEND_FEE_BPS = 10n;
/** 1%: the most this panel accepts as a send's fee. */
export const MAX_SEND_FEE_BPS = 100;

/** zSol answered, but not with its fee wallet's setup. */
export class SetupUnread extends Error {
  override readonly name = "SetupUnread";
}

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null ? Reflect.get(body, name) : undefined;
}

function addressIn(body: unknown, name: string): Address {
  const value = field(body, name);
  if (typeof value !== "string" || !BASE58_ADDRESS.test(value)) throw new SetupUnread(name);
  return address(value);
}

/** zSol's fee wallet's public setup: who pays the network fee, where the fee goes, and whether it can pay now. */
export async function sponsorSetup(site: string): Promise<SponsorSetup> {
  const response = await siteFetch(site)(`${site}/api/sponsor`, { cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 503 && field(body, "error") === "unavailable") {
    return {
      feePayer: address("11111111111111111111111111111111"),
      treasury: address("11111111111111111111111111111111"),
      feeAssets: new Set(),
      sendFeeBps: DEFAULT_SEND_FEE_BPS,
      paused: "off",
    };
  }
  if (!response.ok) throw new SetupUnread(String(response.status));
  const assets = field(body, "feeAssets");
  const paused = field(body, "paused");
  const bps = field(body, "sendFeeBps");
  // The panel never builds a send whose fee is above this, whatever zSol answers.
  if (typeof bps === "number" && (!Number.isInteger(bps) || bps < 0 || bps > MAX_SEND_FEE_BPS)) {
    throw new SetupUnread("sendFeeBps");
  }
  return {
    feePayer: addressIn(body, "feePayer"),
    treasury: addressIn(body, "treasury"),
    feeAssets: new Set(
      Array.isArray(assets) ? assets.filter((each) => typeof each === "string") : [],
    ),
    sendFeeBps: typeof bps === "number" ? BigInt(bps) : DEFAULT_SEND_FEE_BPS,
    paused:
      paused === "fee-wallet" || paused === "treasury"
        ? paused
        : field(body, "canPay") === false
          ? "fee-wallet"
          : null,
  };
}

/** zSol's fee wallet said no: `code` names why. */
export class SponsorRefused extends Error {
  override readonly name = "SponsorRefused";
  constructor(
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(`zSol's fee wallet refused: ${code}`);
  }
}

/** Sent, but not seen landing yet: it may still land. */
export class SendUnconfirmed extends Error {
  override readonly name = "SendUnconfirmed";
  constructor(
    readonly signature: Signature,
    options?: ErrorOptions,
  ) {
    super(`Sent ${signature}, not confirmed yet`, options);
  }
}

/** The connection dropped while zSol was sending it: it may have gone through. */
export class SendUnanswered extends Error {
  override readonly name = "SendUnanswered";
}

/** It landed, but the private wallet didn't read it back yet. */
export class SyncBehind extends Error {
  override readonly name = "SyncBehind";
  constructor(
    readonly signature: Signature,
    options?: ErrorOptions,
  ) {
    super(`Landed ${signature}, not read back yet`, options);
  }
}

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

export async function submitSponsored(input: {
  readonly site: string;
  readonly client: SprClient;
  readonly spender: Spender;
  readonly transaction: Transaction;
  readonly onStep: (step: SendStep) => void;
  /** Reads the private wallet again once the send landed at `slot`. */
  readonly readBack: (slot: bigint) => Promise<void>;
}): Promise<Signature> {
  input.onStep("signing");
  const signed = await partiallySignTransactionWithSigners(
    [input.spender.keypair.toSolanaSigner()],
    input.transaction,
  );
  const keys = await sponsorKeys(input.client, input.spender, signed);
  const body = JSON.stringify({
    transaction: getBase64EncodedWireTransaction(signed),
    txViewingKey: base64(keys.txViewingKey),
    receivers: keys.receivers.map((receiver) => ({
      slot: receiver.slot,
      asset: receiver.asset,
      nullifierPublicKey: base64(receiver.nullifierPublicKey),
    })),
  });
  keys.txViewingKey.fill(0);
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
    );
  }
  const sent = toSignature(signature);
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
