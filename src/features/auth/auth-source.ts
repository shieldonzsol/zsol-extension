// Who is signed in to zSol, as headers on a call to its API. The panel's pages ask Privy; the
// background reads what the panel last kept for it in session storage, which pages of other
// sites can't read.
import { browser } from "wxt/browser";

export type AuthHeaders = Record<string, string>;
type AuthSource = () => Promise<AuthHeaders | null>;

const KEPT = "auth";
/** Privy's access token lives about an hour; the background stops trusting a copy sooner. */
const KEPT_FOR_MS = 50 * 60_000;

let source: AuthSource = keptHeaders;

/** The panel's pages sign in with Privy and set this; the background keeps the default. */
export function setAuthSource(next: AuthSource): void {
  source = next;
}

/** Null once nobody is signed in; throws when the sign-in can't be read just now. */
export function authHeaders(): Promise<AuthHeaders | null> {
  return source();
}

/** Keeps the panel's current sign-in for the background, while the panel is closed. */
export async function keepHeaders(headers: AuthHeaders | null): Promise<void> {
  if (headers) await browser.storage.session.set({ [KEPT]: { headers, at: Date.now() } });
  else await browser.storage.session.remove(KEPT);
}

async function keptHeaders(): Promise<AuthHeaders | null> {
  const kept: unknown = (await browser.storage.session.get(KEPT))[KEPT];
  if (typeof kept !== "object" || kept === null) return null;
  const at: unknown = Reflect.get(kept, "at");
  const headers: unknown = Reflect.get(kept, "headers");
  if (typeof at !== "number" || Date.now() - at > KEPT_FOR_MS) return null;
  if (typeof headers !== "object" || headers === null) return null;
  const read: AuthHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") read[name] = value;
  }
  return typeof read.authorization === "string" ? read : null;
}
