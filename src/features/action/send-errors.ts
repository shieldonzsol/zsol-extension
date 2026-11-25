// How a send through zSol stops: refused, sent but not seen landing, its answer lost, or landed
// but not read back yet.
import type { Signature } from "@solana/kit";

/** How many private actions zSol's fee wallet pays for per account, in one window. */
export interface SponsorBudget {
  readonly window: "hour" | "day";
  readonly limit: number;
}

/** zSol's fee wallet said no: `code` names why. */
export class SponsorRefused extends Error {
  override readonly name = "SponsorRefused";
  constructor(
    readonly code: string,
    readonly retryAfterSeconds?: number,
    /** The account's budget is used up. */
    readonly budget?: SponsorBudget,
  ) {
    super(`zSol's fee wallet refused: ${code}`);
  }
}

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null ? Reflect.get(body, name) : undefined;
}

/** The account's budget, when zSol named it in a refusal. */
export function budgetIn(answer: unknown): SponsorBudget | undefined {
  const budget = field(answer, "budget");
  const window = field(budget, "window");
  const limit = field(budget, "limit");
  return (window === "hour" || window === "day") && typeof limit === "number"
    ? { window, limit }
    : undefined;
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
