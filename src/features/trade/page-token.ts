// The token on the page zSol was opened from: its mint, read from the tab's address on the sites
// traders use. Chrome gives the panel that address only for the tab the toolbar button was
// pressed on, and only while it stays on that page.
import { isAddress } from "@solana/kit";

/** Paths whose segment after the marker is a token's mint. */
const MINT_PATHS: readonly { readonly host: RegExp; readonly after: string }[] = [
  { host: /(^|\.)gmgn\.ai$/, after: "token" },
  { host: /(^|\.)pump\.fun$/, after: "coin" },
  { host: /(^|\.)birdeye\.so$/, after: "token" },
  { host: /(^|\.)solscan\.io$/, after: "token" },
  { host: /(^|\.)jup\.ag$/, after: "tokens" },
  { host: /(^|\.)explorer\.solana\.com$/, after: "address" },
  { host: /(^|\.)bullx\.io$/, after: "terminal" },
];

const SOL_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "11111111111111111111111111111111",
]);

/** A segment's mint, also after a referral prefix ("abc_<mint>"). */
function mintIn(segment: string): string | null {
  const text = decodeURIComponent(segment).trim();
  const last = text.includes("_") ? text.slice(text.lastIndexOf("_") + 1) : text;
  return isAddress(last) && !SOL_MINTS.has(last) ? last : null;
}

/**
 * The mints an address may name, best first: a known site's token path, then its query's
 * values, then any other path segment. Each is checked to be a token before it is offered.
 */
export function mintsInUrl(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  if (parsed.protocol !== "https:") return [];
  const segments = parsed.pathname.split("/").filter((each) => each !== "");
  const found: string[] = [];
  const add = (mint: string | null) => {
    if (mint && !found.includes(mint)) found.push(mint);
  };
  for (const known of MINT_PATHS) {
    if (!known.host.test(parsed.hostname)) continue;
    const at = segments.indexOf(known.after);
    if (at >= 0 && segments[at + 1]) add(mintIn(segments[at + 1]!));
  }
  // jup.ag/swap/SOL-<mint>: the side that isn't SOL.
  if (/(^|\.)jup\.ag$/.test(parsed.hostname)) {
    const swap = segments[segments.indexOf("swap") + 1];
    for (const side of swap?.split("-") ?? []) add(mintIn(side));
  }
  for (const value of parsed.searchParams.values()) add(mintIn(value));
  for (const segment of segments) add(mintIn(segment));
  return found.slice(0, 3);
}
