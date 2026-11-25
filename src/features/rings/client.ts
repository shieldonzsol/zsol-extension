// The panel's Rings client: Solana, the indexer and the prover all through the paired zSol's
// API, which holds the keys and the budgets. The prover's enclave is still checked here.
import { createSprClient } from "@heliuslabs/spr";
import { SignedTeePolicy, type SprClient } from "@heliuslabs/spr/client";

import { siteFetch } from "./site-fetch";

export type { SprClient } from "@heliuslabs/spr/client";

export {
  CLIENT_HEADER,
  clientName,
  lastBusy,
  lastTooOld,
  lastUnanswered,
  lastUnauthorized,
  siteFetch,
} from "./site-fetch";

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
