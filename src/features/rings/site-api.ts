// Calls to the paired zSol's own API. Each failure is named, so the panel can say plainly what
// went wrong and whether trying again can help.
import { authHeaders } from "@/features/privy/auth-headers";

import { siteFetch } from "./client";

export type SiteFailure =
  /** The browser is offline. */
  | "offline"
  /** zSol didn't answer, or answered with a server error. */
  | "unreachable"
  /** zSol no longer serves this version. */
  | "update"
  /** The panel's sign-in ended. */
  | "signed-out"
  /** zSol refused the call: the origin, or a malformed body. */
  | "refused";

export class SiteError extends Error {
  override readonly name = "SiteError";
  constructor(readonly failure: SiteFailure) {
    super(`zSol's API: ${failure}`);
  }
}

export async function siteCall(
  site: string,
  path: `/api/${string}`,
  init: { readonly method?: "GET" | "POST"; readonly body?: unknown } = {},
): Promise<unknown> {
  if (!navigator.onLine) throw new SiteError("offline");
  let auth: Record<string, string> | null;
  try {
    auth = await authHeaders();
  } catch {
    throw new SiteError(navigator.onLine ? "unreachable" : "offline");
  }
  if (!auth) throw new SiteError("signed-out");
  let response: Response;
  try {
    response = await siteFetch(site)(`${site}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...auth,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    throw new SiteError(navigator.onLine ? "unreachable" : "offline");
  }
  if (response.status === 401) throw new SiteError("signed-out");
  if (response.status === 426) throw new SiteError("update");
  if (response.status >= 500) throw new SiteError("unreachable");
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || body === null) throw new SiteError("refused");
  return body;
}
