import type { UserManifest } from "wxt";

/** zSol's website: where the wallet runs today, and where the panel connects later. */
export const ZSOL_URL = "https://zsol.cc";

/**
 * What the extension asks Chrome for. Every permission shows in the store's review and some in
 * the install prompt, so the list stays as short as the panel allows: a new one needs a reason
 * in its pull request.
 */
export const manifest = {
  name: "zSol",
  description:
    "Lightning-fast privacy on a click: zSol's private Solana wallet in your side panel or over your trading terminal.",
  homepage_url: ZSOL_URL,
  // chrome.sidePanel.open() arrived in Chrome 116.
  minimum_chrome_version: "116",
  // Wallet keys never sit in an incognito session.
  incognito: "not_allowed",
  permissions: ["sidePanel"],
  action: { default_title: "Open zSol" },
} satisfies UserManifest;
