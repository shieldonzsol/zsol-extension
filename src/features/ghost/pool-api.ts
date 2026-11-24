// zSol's Ghost Route routes, as the panel asks them: the pool's live rates, a receiver's check,
// a plan registered before anything is signed, and the deposit zSol's server builds and sends.
import { isAddress } from "@solana/kit";

import { siteFetch } from "@/features/rings/client";

import { RATE_CAPS, type PlannedPart, type PoolRates } from "./pool-plan";

/** Why a Ghost Route call stopped, as zSol names it, or what the panel saw. */
export type PoolStopCode =
  | "listed"
  | "too-small"
  | "too-many"
  | "no-shield"
  | "unavailable"
  | "signed-out"
  | "busy"
  | "unreachable"
  | "refused"
  | "over-limit"
  | "short"
  | "failed-on-chain"
  | "status-unknown"
  | "mismatch"
  | "update"
  | "unknown";

export class PoolStopped extends Error {
  override readonly name = "PoolStopped";
  constructor(
    readonly code: PoolStopCode,
    /** The deposit's signature, when it was sent. */
    readonly signature?: string,
    /** Which part of a plan was refused. */
    readonly part?: number,
  ) {
    super(`Ghost Route stopped: ${code}`);
  }
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

const KNOWN: readonly PoolStopCode[] = [
  "listed",
  "too-small",
  "too-many",
  "no-shield",
  "refused",
  "over-limit",
  "short",
  "failed-on-chain",
  "status-unknown",
  "unreachable",
  "mismatch",
  "update",
];

const isKnown = (code: unknown): code is PoolStopCode =>
  typeof code === "string" && (KNOWN as readonly string[]).includes(code);

const codeOf = (said: unknown, status: number): PoolStopCode => {
  // The pool's own stop, when zSol's server passes one on; else zSol's word.
  const code = field(said, "stop") ?? field(said, "error");
  if (isKnown(code)) return code;
  if (status === 426) return "update";
  if (status === 401) return "signed-out";
  if (status === 429) return "busy";
  if (status === 503) return "unavailable";
  return status >= 500 ? "unreachable" : "unknown";
};

async function call(
  site: string,
  path: string,
  init: RequestInit = {},
): Promise<{ readonly status: number; readonly body: unknown }> {
  let response: Response;
  try {
    response = await siteFetch(site)(`${site}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new PoolStopped("unreachable");
  }
  return { status: response.status, body: await response.json().catch(() => null) };
}

const post = (site: string, path: string, body: unknown) =>
  call(site, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const perToken = (value: unknown): number | null => {
  const sol = field(value, "sol");
  return typeof sol === "number" && Number.isFinite(sol) && sol >= 0 ? sol : null;
};

/** What the pool charges now, checked against this panel's caps. */
export async function poolRates(site: string): Promise<PoolRates> {
  const { status, body } = await call(site, "/api/pool/config");
  if (status !== 200) throw new PoolStopped(codeOf(body, status));
  const payoutRate = field(body, "withdraw_fee_rate");
  const payoutFlat = perToken(field(body, "rent_fees"));
  const smallestPayout = perToken(field(body, "minimum_withdrawal"));
  if (
    typeof payoutRate !== "number" ||
    !Number.isFinite(payoutRate) ||
    payoutRate < 0 ||
    payoutRate > RATE_CAPS.payoutRate ||
    payoutFlat === null ||
    payoutFlat > RATE_CAPS.payoutFlat ||
    smallestPayout === null ||
    smallestPayout > RATE_CAPS.smallestPayout
  ) {
    throw new PoolStopped("unknown");
  }
  return { payoutRate, payoutFlat, smallestPayout };
}

/** Whether an address may be paid, and whether it is a zSol wallet a payout can arrive into. */
export async function receiverCheck(
  site: string,
  to: string,
): Promise<{ readonly listed: boolean; readonly zsol: boolean }> {
  if (!isAddress(to)) throw new PoolStopped("unknown");
  const { status, body } = await post(site, "/api/pool/receiver", { address: to });
  if (status !== 200) throw new PoolStopped(codeOf(body, status));
  return { listed: field(body, "listed") === true, zsol: field(body, "zsol") === true };
}

const inPublic = (part: PlannedPart): PlannedPart => ({
  recipient: part.recipient,
  amount: part.amount,
  received: part.received,
  afterMs: part.afterMs,
});

const asked = (site: string, body: unknown) => post(site, "/api/pool-payouts", body);

/**
 * Registers a plan before anything is signed. A part that can't arrive shielded after all is
 * asked for again in public, at most once a part.
 */
export async function registerPlan(input: {
  readonly site: string;
  readonly plan: string;
  readonly payer: string;
  readonly parts: readonly PlannedPart[];
  readonly prove: (parts: readonly PlannedPart[]) => string;
}): Promise<readonly PlannedPart[]> {
  let parts = input.parts;
  for (let tries = 0; tries <= input.parts.length; tries += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each try depends on the last one's answer.
    const { status, body } = await asked(input.site, {
      kind: "plan",
      way: "out",
      plan: input.plan,
      payer: input.payer,
      parts: parts.map((part) => ({
        recipient: part.recipient,
        amount: String(part.amount),
        afterMs: part.afterMs,
        ...(part.shield ? { shield: true } : {}),
      })),
      proof: input.prove(parts),
    });
    if (status === 200) return parts;
    const code = codeOf(body, status);
    const part = field(body, "part");
    if (code !== "no-shield" || typeof part !== "number") {
      throw new PoolStopped(code, undefined, typeof part === "number" ? part : undefined);
    }
    parts = parts.map((each, index) => (index === part ? inPublic(each) : each));
  }
  throw new PoolStopped("unavailable");
}

/** Asks zSol's server to read the pool's new notes ahead of the deposit's build. */
export const readAhead = (site: string, plan: string) =>
  asked(site, { kind: "read", plan }).then(
    () => undefined,
    () => undefined,
  );

/** Drops a plan whose deposit never went out. */
export const dropPlan = (site: string, plan: string) =>
  asked(site, { kind: "drop", plan }).then(
    () => undefined,
    () => undefined,
  );

/** The deposit zSol's server built for the plan, unsigned, as wire bytes in base64. */
export async function preparedDeposit(site: string, plan: string): Promise<string> {
  const { status, body } = await asked(site, { kind: "prepare", plan });
  const transaction = field(body, "transaction");
  if (status === 200 && typeof transaction === "string" && transaction.length < 8_000) {
    return transaction;
  }
  throw new PoolStopped(codeOf(body, status));
}

/** Hands the signed deposit back; zSol's server sends it and starts the plan when it lands. */
export async function sentDeposit(site: string, plan: string, signed: string): Promise<string> {
  const { status, body } = await asked(site, { kind: "send", plan, signed });
  const signature = field(body, "signature");
  if (status === 200 && typeof signature === "string") return signature;
  // No word of the pool's on a server error: it may have gone out all the same.
  throw new PoolStopped(
    status >= 500 && field(body, "stop") === undefined ? "status-unknown" : codeOf(body, status),
    typeof signature === "string" ? signature : undefined,
  );
}
