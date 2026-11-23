import type { UserManifest } from "wxt";

export const ZSOL_URL = "https://zsol.cc";

// Development builds also pair with the local site.
const ZSOL_LOCAL = "https://zsol.localhost";

const originsFor = (mode: string) => (mode === "development" ? [ZSOL_URL, ZSOL_LOCAL] : [ZSOL_URL]);

export const ZSOL_ORIGINS: readonly string[] = originsFor(import.meta.env.MODE);

export function manifestFor(mode: string) {
  return {
    name: "zSol",
    description:
      "Lightning-fast privacy on a click: zSol's private Solana wallet in your side panel or over your trading terminal.",
    homepage_url: ZSOL_URL,
    // X25519 in Web Crypto.
    minimum_chrome_version: "133",
    incognito: "not_allowed",
    permissions: ["sidePanel"],
    action: { default_title: "Open zSol" },
    externally_connectable: { matches: originsFor(mode).map((origin) => `${origin}/*`) },
  } satisfies UserManifest;
}
