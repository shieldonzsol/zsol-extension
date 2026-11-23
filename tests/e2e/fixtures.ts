import path from "node:path";

import { chromium, test as base, type BrowserContext } from "@playwright/test";

const EXTENSION = path.resolve(".output/chrome-mv3");

// Branded Chrome no longer loads unpacked extensions from the command line; Chromium does.
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's needs from this pattern.
  context: async ({}, provide) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    await provide(context);
    await context.close();
  },
  extensionId: async ({ context }, provide) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await provide(new URL(worker.url()).host);
  },
});

export const expect = test.expect;
