// Privy's tokens for a call to zSol's API: the server reads who is signed in from them, never
// from a cookie. Each fresh pair is also kept for the background, for the overlay's clicks.
import { getAccessToken } from "@privy-io/react-auth";

import { keepHeaders, setAuthSource, type AuthHeaders } from "@/features/auth/auth-source";

// The identity token as Privy last stored it. Asking Privy for it fetches the user again, which
// Privy limits; the access token renews by itself.
let identity: string | null = null;
let kept: string | null = null;

export function setIdentityToken(token: string | null) {
  identity = token;
}

async function privyHeaders(): Promise<AuthHeaders | null> {
  const access = await getAccessToken();
  if (!access) {
    if (kept !== null) void keepHeaders(null).catch(() => undefined);
    kept = null;
    return null;
  }
  const headers: AuthHeaders = {
    authorization: `Bearer ${access}`,
    ...(identity ? { "privy-id-token": identity } : {}),
  };
  const now = `${access}|${identity ?? ""}`;
  if (now !== kept) {
    kept = now;
    void keepHeaders(headers).catch(() => undefined);
  }
  return headers;
}

setAuthSource(privyHeaders);

export { authHeaders } from "@/features/auth/auth-source";
