// Turning the overlay on and off for one site: Chrome's own prompt for that site, then the chip's
// script registered there; off, the script goes and the site's permission is given back.
import { browser } from "wxt/browser";

import { OVERLAY_SITES, scriptIdOf, type OverlaySite } from "./sites";

const SCRIPT = "content-scripts/overlay.js";

/** Asks Chrome for the site, from a click, and adds the chip there. False when refused. */
export async function turnOn(site: OverlaySite): Promise<boolean> {
  const granted = await browser.permissions.request({ origins: [site.pattern] });
  if (!granted) return false;
  const id = scriptIdOf(site);
  const known = await browser.scripting.getRegisteredContentScripts({ ids: [id] });
  if (known.length === 0) {
    await browser.scripting.registerContentScripts([
      {
        id,
        matches: [site.pattern],
        js: [SCRIPT],
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
  }
  return true;
}

export async function turnOff(site: OverlaySite): Promise<void> {
  const id = scriptIdOf(site);
  const known = await browser.scripting.getRegisteredContentScripts({ ids: [id] });
  if (known.length > 0) await browser.scripting.unregisterContentScripts({ ids: [id] });
  await browser.permissions.remove({ origins: [site.pattern] }).catch(() => false);
}

/** The sites the overlay is on: allowed by Chrome and registered. */
export async function sitesOn(): Promise<ReadonlySet<string>> {
  const scripts = await browser.scripting.getRegisteredContentScripts();
  const ids = new Set(scripts.map((each) => each.id));
  const granted = await Promise.all(
    OVERLAY_SITES.map((site) => browser.permissions.contains({ origins: [site.pattern] })),
  );
  return new Set(
    OVERLAY_SITES.filter((site, at) => granted[at] && ids.has(scriptIdOf(site))).map(
      (site) => site.id,
    ),
  );
}

/** A site whose permission was taken back in Chrome's settings loses its script too. */
export async function syncSites(): Promise<void> {
  const scripts = await browser.scripting.getRegisteredContentScripts();
  for (const site of OVERLAY_SITES) {
    if (!scripts.some((each) => each.id === scriptIdOf(site))) continue;
    // oxlint-disable-next-line no-await-in-loop
    if (!(await browser.permissions.contains({ origins: [site.pattern] }))) {
      // oxlint-disable-next-line no-await-in-loop
      await browser.scripting.unregisterContentScripts({ ids: [scriptIdOf(site)] });
    }
  }
}
