// Privy's tokens for a call to zSol's API: the server reads who is signed in from them, never
// from a cookie.
import { getAccessToken } from "@privy-io/react-auth";

// The identity token as Privy last stored it. Asking Privy for it fetches the user again, which
// Privy limits; the access token renews by itself.
let identity: string | null = null;

export function setIdentityToken(token: string | null) {
  identity = token;
}

/** Null once the session is gone; throws when Privy can't answer just now. */
export async function authHeaders(): Promise<Record<string, string> | null> {
  const access = await getAccessToken();
  if (!access) return null;
  return {
    authorization: `Bearer ${access}`,
    ...(identity ? { "privy-id-token": identity } : {}),
  };
}
