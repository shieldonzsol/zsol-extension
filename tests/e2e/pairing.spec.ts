import { readFile } from "node:fs/promises";
import path from "node:path";

import type { BrowserContext, Page } from "@playwright/test";

import type { PairingPayload } from "../../src/features/pairing/protocol";

import { expect, test } from "./fixtures";
import { ZSOL_PAGE_DIR } from "./global-setup";

const payload: PairingPayload = {
  v: 1,
  wallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  seed: btoa(String.fromCharCode(...new Uint8Array(32).fill(5))),
};

// The extension trusts https://zsol.cc only, so the stand-in page is served at that address.
async function zsolPage(context: BrowserContext): Promise<Page> {
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

async function panel(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const code = await page.getByRole("status").textContent();
  if (!code) throw new Error("no code on the panel");
  return { page, code };
}

function pair(page: Page, extensionId: string, code: string) {
  return page.evaluate(
    ([id, typed, sent]) => {
      if (!window.zsolPair) throw new Error("the stand-in page didn't load");
      return window.zsolPair(id, typed, sent);
    },
    [extensionId, code, payload] as const,
  );
}

test("zsol.cc connects the panel with the code it shows", async ({ context, extensionId }) => {
  const { page: sidePanel, code } = await panel(context, extensionId);
  const zsol = await zsolPage(context);

  const result = await pair(zsol, extensionId, code.toLowerCase());
  expect(result).toMatchObject({ hello: { ok: true, v: 1 }, seal: { ok: true } });

  await expect(sidePanel.getByRole("heading", { name: "Connected" })).toBeVisible();
  await expect(sidePanel.getByText("7xKX…gAsU")).toBeVisible();
});

test("a wrong code gets nothing", async ({ context, extensionId }) => {
  const { page: sidePanel } = await panel(context, extensionId);
  const zsol = await zsolPage(context);

  expect(await pair(zsol, extensionId, "0000-0000")).toEqual({
    hello: { ok: false, reason: "wrong-code" },
  });
  await expect(sidePanel.getByRole("heading", { name: "Connect your zSol account" })).toBeVisible();
});
