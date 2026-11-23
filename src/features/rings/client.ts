// The panel's Rings client: Solana, the indexer and the prover all through the paired zSol's
// API, which holds the keys and the budgets. The prover's enclave is still checked here.
import { createSprClient } from "@heliuslabs/spr";
import { SignedTeePolicy, type SprClient } from "@heliuslabs/spr/client";
import { browser } from "wxt/browser";

export type { SprClient } from "@heliuslabs/spr/client";

/** Tells zSol which client asks, so it can say when this version is too old. */
export const CLIENT_HEADER = "x-zsol-client";

export function clientName(): string {
  return `extension/${browser.runtime.getManifest().version}`;
}

let unanswered = 0;

/** When zSol last failed to answer a call (no answer, or a server error), in ms. */
export const lastUnanswered = () => unanswered;

/** `fetch`, naming this client on every call to `site` and nowhere else. */
export function siteFetch(site: string): typeof fetch {
  const name = clientName();
  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(`${site}/`)) return fetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    headers.set(CLIENT_HEADER, name);
    return fetch(input, { ...init, headers }).then(
      (response) => {
        if (response.status >= 500 || response.status === 429) unanswered = Date.now();
        return response;
      },
      (error: unknown) => {
        unanswered = Date.now();
        throw error;
      },
    );
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
