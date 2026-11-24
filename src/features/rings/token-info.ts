// A token's name, symbol and decimals, from zSol's token card, kept for this panel's life. When
// the card can't be read, the chain still gives the decimals, so an amount is never misread.
import { isAddress, type Address } from "@solana/kit";

import { siteFetch, type SprClient } from "./client";
import type { Asset } from "./holdings";

export interface TokenInfo extends Asset {
  readonly name: string | null;
  readonly verified: boolean;
  /** Why a private balance can't hold it, as zSol says; null when it can. */
  readonly refused: string | null;
  /** A Token-2022 transfer fee, in basis points; null when it has none. */
  readonly transferFeeBps: number | null;
}

const known = new Map<string, Promise<TokenInfo>>();

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

const short = (mint: string) => `${mint.slice(0, 4)}…`;

const validDecimals = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 18;

async function fromCard(site: string, mint: string): Promise<TokenInfo | null> {
  const response = await siteFetch(site)(`${site}/api/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mint }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const card: unknown = await response.json().catch(() => null);
  const decimals = field(card, "decimals");
  if (field(card, "status") !== "token" || !validDecimals(decimals)) return null;
  const symbol = field(card, "symbol");
  const name = field(card, "name");
  const refused = field(card, "refused");
  const fee = field(card, "transferFeeBps");
  return {
    mint,
    symbol:
      typeof symbol === "string" && symbol.trim() !== "" ? symbol.trim().slice(0, 16) : short(mint),
    decimals,
    places: 4,
    name: typeof name === "string" ? name.slice(0, 64) : null,
    verified: field(card, "verified") === true,
    refused:
      refused === null || refused === undefined
        ? null
        : typeof refused === "string"
          ? refused.slice(0, 64)
          : "refused",
    transferFeeBps: typeof fee === "number" ? fee : null,
  };
}

async function fromChain(client: SprClient, mint: Address): Promise<TokenInfo> {
  const { value } = await client.solanaRpc
    .getAccountInfo(mint, { encoding: "jsonParsed", commitment: "confirmed" })
    .send();
  const decimals = field(field(field(value?.data, "parsed"), "info"), "decimals");
  if (!validDecimals(decimals)) throw new Error(`No token at ${mint}.`);
  return {
    mint,
    symbol: short(mint),
    decimals,
    places: 4,
    name: null,
    verified: false,
    refused: null,
    transferFeeBps: null,
  };
}

/** What a mint is; read once, then kept. Throws when it isn't a token. */
export function tokenInfo(site: string, client: SprClient, mint: string): Promise<TokenInfo> {
  if (!isAddress(mint)) return Promise.reject(new Error("Not a mint address."));
  let found = known.get(mint);
  if (!found) {
    found = fromCard(site, mint)
      .catch(() => null)
      .then((card) => card ?? fromChain(client, mint));
    known.set(mint, found);
    // A failed read is asked again next time.
    found.catch(() => known.delete(mint));
  }
  return found;
}
