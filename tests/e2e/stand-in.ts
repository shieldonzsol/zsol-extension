import { readFile } from "node:fs/promises";
import path from "node:path";

import type { BrowserContext, Page } from "@playwright/test";

import type { PairingPayload } from "../../src/features/pairing/protocol";

import { ZSOL_PAGE_DIR } from "./global-setup";

export const payload: PairingPayload = {
  v: 1,
  wallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  seed: btoa(String.fromCharCode(...new Uint8Array(32).fill(5))),
};

// The extension trusts https://zsol.cc only, so the stand-in page is served at that address.
export async function zsolPage(context: BrowserContext): Promise<Page> {
  await context.route("https://zsol.cc/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith(".js")) {
      const body = await readFile(path.join(ZSOL_PAGE_DIR, path.basename(pathname)), "utf8");
      return route.fulfill({ contentType: "text/javascript", body });
    }
    return route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><script type="module" src="/zsol-page.js"></script>',
    });
  });
  const page = await context.newPage();
  await page.goto("https://zsol.cc/extension/connect");
  await page.waitForFunction(() => "zsolPair" in window);
  return page;
}

export async function panel(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const code = await page.getByRole("status").textContent();
  if (!code) throw new Error("no code on the panel");
  return { page, code };
}

export function pair(page: Page, extensionId: string, code: string) {
  return page.evaluate(
    ([id, typed, sent]) => {
      if (!window.zsolPair) throw new Error("the stand-in page didn't load");
      return window.zsolPair(id, typed, sent);
    },
    [extensionId, code, payload] as const,
  );
}
