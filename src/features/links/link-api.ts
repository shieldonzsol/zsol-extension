// The creator's Dark links as zSol lists them: each one's number in the creator's key tree and
// its one-time address, never its key. A link is listed before it is paid, so one never goes
// missing when a send stops halfway.
import { isAddress } from "@solana/kit";

import { siteCall } from "@/features/rings/site-api";
import { MAX_LINK_INDEX } from "@/features/rings/links";

export type LinkState = "open" | "claimed" | "taken_back";

export interface LinkRow {
  readonly index: number;
  readonly address: string;
  readonly state: LinkState;
  /** When it was made, in ms. */
  readonly createdAt: number;
  /** Paid by Ghost Route and not landed yet: when its last part lands, in ms. */
  readonly arrivesAt: number | null;
}

export type Listed = "ok" | "taken" | "refused";

export type Closed = { readonly kind: "closed" } | { readonly kind: "due"; readonly at: number };

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null ? Reflect.get(body, name) : undefined;
}

const STATES = new Set<string>(["open", "claimed", "taken_back"]);
const isState = (value: unknown): value is LinkState =>
  typeof value === "string" && STATES.has(value);

const isIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_LINK_INDEX;

/** One listed link as zSol answered it; null for a row that isn't one. */
export function rowOf(raw: unknown): LinkRow | null {
  const index = field(raw, "index");
  const address = field(raw, "address");
  const state = field(raw, "state");
  const createdAt = Date.parse(String(field(raw, "createdAt")));
  const arrivesAt = field(raw, "arrivesAt");
  if (!isIndex(index) || typeof address !== "string" || !isAddress(address)) return null;
  if (!isState(state) || Number.isNaN(createdAt)) return null;
  return {
    index,
    address,
    state,
    createdAt,
    arrivesAt: typeof arrivesAt === "number" && Number.isFinite(arrivesAt) ? arrivesAt : null,
  };
}

/** The creator's links, newest first. */
export async function readLinks(site: string): Promise<LinkRow[]> {
  const rows = field(await siteCall(site, "/api/dark-links"), "links");
  if (!Array.isArray(rows)) return [];
  return rows
    .map(rowOf)
    .filter((row) => row !== null)
    .toSorted((a, b) => b.index - a.index);
}

/** The number the next link takes: one past the highest listed. */
export const nextIndex = (rows: readonly Pick<LinkRow, "index">[]): number =>
  rows.reduce((next, row) => Math.max(next, row.index + 1), 0);

export async function listLink(site: string, index: number, address: string): Promise<Listed> {
  const listed = field(
    await siteCall(site, "/api/dark-links", {
      method: "POST",
      body: { action: "list", index, address },
    }),
    "listed",
  );
  return listed === "ok" || listed === "taken" ? listed : "refused";
}

/** Closes an open link that holds nothing; one whose Ghost Route payout is on its way stays. */
export async function closeLink(site: string, index: number): Promise<Closed> {
  const answer = await siteCall(site, "/api/dark-links", {
    method: "POST",
    body: { action: "close", index },
  });
  const at = field(answer, "at");
  return field(answer, "kind") === "due" && typeof at === "number"
    ? { kind: "due", at }
    : { kind: "closed" };
}
