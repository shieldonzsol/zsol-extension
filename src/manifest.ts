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
  description: "A private Solana wallet for traders, in your browser's side panel.",
  homepage_url: ZSOL_URL,
  // chrome.sidePanel.open() arrived in Chrome 116.
  minimum_chrome_version: "116",
  // Wallet keys never sit in an incognito session.
  incognito: "not_allowed",
  permissions: ["sidePanel"],
  action: { default_title: "Open zSol" },
} satisfies UserManifest;
