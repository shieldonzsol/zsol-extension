import type { UserManifest } from "wxt";

export const ZSOL_URL = "https://zsol.cc";

// Development builds also pair with the local site, on its named host or its plain port.
const ZSOL_LOCAL = ["https://zsol.localhost", "http://localhost:3112"];

// Development builds get a fixed id, imigicgmjamahdpfeiciegalcbgpmfhh; the store assigns its own.
const DEV_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxx6Vcy2qDxeQjtNqv6IMg5InD5muIjdRg1o4rnISD5ebQRGCt2Ob2r4RctTEmUuxU6VaEew1L1DJz9GX3Cez790WywetfoUetWYWxHumWAMOttuFQY8W64hTr7+I/3aq/7pzJMeQlBhokrgSprAk9+xC/tBNzmk0N5AUmFRSfBiQMZdP0/dhv7WklpsVdO5LVWwha5iU+idjtd6xee83ME2l+9ka57obpRSqMKo1aheVVb05tExxIrMX+hQfZk9MWu3UMzv0lJb/FBhYV0nmg+L+Htx18Qi3ybTwTf0qSN8vP0vCLTsi/zexL47nir/jfh79BLg5sgeYgtsqmEtY7wIDAQAB";

const originsFor = (mode: string) =>
  mode === "development" ? [ZSOL_URL, ...ZSOL_LOCAL] : [ZSOL_URL];

// Chrome's match patterns carry no port.
const matchFor = (origin: string) => `${origin.replace(/:\d+$/, "")}/*`;

export const ZSOL_ORIGINS: readonly string[] = originsFor(import.meta.env.MODE);

export const EXTENSION_PAGES_POLICY = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";

export function manifestFor(mode: string) {
  return {
    name: "zSol",
    description:
      "Lightning-fast privacy on a click: zSol's private Solana wallet in your side panel or over your trading terminal.",
    homepage_url: ZSOL_URL,
    // Ed25519 in Web Crypto.
    minimum_chrome_version: "137",
    incognito: "not_allowed",
    permissions: ["sidePanel"],
    action: { default_title: "Open zSol" },
    externally_connectable: { matches: originsFor(mode).map(matchFor) },
    // The private wallet's hasher is WebAssembly shipped in the package.
    content_security_policy: { extension_pages: EXTENSION_PAGES_POLICY },
    ...(mode === "development" ? { key: DEV_KEY } : {}),
  } satisfies UserManifest;
}
