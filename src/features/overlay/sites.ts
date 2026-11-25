// The trading terminals the overlay may join. None is asked for at install: each is allowed by
// the trader, one site at a time, from the panel.
export interface OverlaySite {
  readonly id: string;
  readonly name: string;
  /** Chrome's match pattern for the site. */
  readonly pattern: string;
  readonly host: string;
}

const site = (id: string, name: string, host: string): OverlaySite => ({
  id,
  name,
  host,
  pattern: `https://${host}/*`,
});

export const OVERLAY_SITES: readonly OverlaySite[] = [
  site("axiom", "Axiom", "axiom.trade"),
  site("gmgn", "GMGN", "gmgn.ai"),
  site("padre", "Terminal by Padre", "trade.padre.gg"),
  site("bullx", "BullX", "neo.bullx.io"),
  site("photon", "Photon", "photon-sol.tinyastro.io"),
  site("pump", "pump.fun", "pump.fun"),
  site("dexscreener", "DEX Screener", "dexscreener.com"),
  site("birdeye", "Birdeye", "birdeye.so"),
];

export const OVERLAY_PATTERNS: readonly string[] = OVERLAY_SITES.map((each) => each.pattern);

/** The site a page's address belongs to, over https only. */
export function siteOfUrl(url: string | undefined): OverlaySite | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  return OVERLAY_SITES.find((each) => each.host === parsed.hostname) ?? null;
}

/** The id the overlay's script is registered under for a site. */
export const scriptIdOf = (each: OverlaySite) => `overlay-${each.id}`;
