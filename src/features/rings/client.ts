// The panel's Rings client: Solana, the indexer and the prover all through the paired zSol's
// API, which holds the keys and the budgets. The prover's enclave is still checked here.
import { createSprClient } from "@heliuslabs/spr";
import { SignedTeePolicy, type SprClient } from "@heliuslabs/spr/client";
import { browser } from "wxt/browser";

import { authHeaders } from "@/features/privy/auth-headers";

export type { SprClient } from "@heliuslabs/spr/client";

/** Tells zSol which client asks, so it can say when this version is too old. */
export const CLIENT_HEADER = "x-zsol-client";

export function clientName(): string {
  return `extension/${browser.runtime.getManifest().version}`;
}

let unanswered = 0;
let unauthorized = 0;
let busy = { at: 0, retryAfter: 0 };

/** When zSol last failed to answer a call (no answer, or a server error), in ms. */
export const lastUnanswered = () => unanswered;
/** When zSol last answered that the panel isn't signed in, in ms. */
export const lastUnauthorized = () => unauthorized;
/** When zSol last answered that this account asks too often, and the seconds it said to wait. */
export const lastBusy = () => busy;

/**
 * `fetch` for calls to `site`, and to nowhere else: names this client and, unless `open`,
 * carries the panel's sign-in, so zSol can ask for one on any of its routes.
 */
export function siteFetch(site: string, open = false): typeof fetch {
  const name = clientName();
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(`${site}/`)) return fetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    headers.set(CLIENT_HEADER, name);
    if (!open && !headers.has("authorization")) {
      const auth = await authHeaders().catch(() => null);
      for (const [key, value] of Object.entries(auth ?? {})) headers.set(key, value);
    }
    try {
      const response = await fetch(input, { ...init, headers });
      if (response.status >= 500 || response.status === 429) unanswered = Date.now();
      if (response.status === 401) unauthorized = Date.now();
      if (response.status === 429) {
        const wait = Number(response.headers.get("retry-after"));
        busy = { at: Date.now(), retryAfter: Number.isFinite(wait) && wait > 0 ? wait : 0 };
      }
      return response;
    } catch (error) {
      unanswered = Date.now();
      throw error;
    }
  };
}

export function ringsClient(site: string): Promise<SprClient> {
  const base = `${site}/api/rings`;
  return createSprClient({
    solanaRpcUrl: `${base}/solana`,
    indexerUrl: `${base}/spr`,
    proverUrl: `${base}/spr`,
    proverTee: SignedTeePolicy.forNetwork("mainnet"),
    fetch: siteFetch(site),
  });
}
