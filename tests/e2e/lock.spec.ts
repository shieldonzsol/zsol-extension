import type { BrowserContext, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { pair, panel, zsolPage } from "./stand-in";

async function connected(context: BrowserContext, extensionId: string): Promise<Page> {
  const { page, code } = await panel(context, extensionId);
  const zsol = await zsolPage(context);
  await pair(zsol, extensionId, code);
  await expect(page.getByRole("button", { name: "Lock zSol" })).toBeVisible();
  return page;
}

async function reopen(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return page;
}

test("a reopened panel keeps the wallet open, and Lock reaches every window", async ({
  context,
  extensionId,
}) => {
  const first = await connected(context, extensionId);
  const second = await reopen(context, extensionId);
  await expect(second.getByRole("button", { name: "Lock zSol" })).toBeVisible();

  await second.getByRole("button", { name: "Lock zSol" }).click();
  for (const page of [first, second]) {
    await expect(page.getByRole("heading", { name: "zSol is locked" })).toBeVisible();
    await expect(page.getByText("You locked it.")).toBeVisible();
  }
  const local: unknown = await first.evaluate("chrome.storage.local.get(null)");
  expect(JSON.stringify(local)).not.toContain('"seed"');

  const third = await reopen(context, extensionId);
  await expect(third.getByRole("heading", { name: "zSol is locked" })).toBeVisible();
  await expect(third.getByText("7xKX…gAsU")).toBeVisible();
});

test("it locks once nobody used it for the time picked", async ({ context, extensionId }) => {
  const page = await connected(context, extensionId);
  await page.evaluate(`chrome.storage.local.set({ "lock-after": 1 })`);
  await page.evaluate(`chrome.storage.session.set({ "active-at": Date.now() - 2 * 60_000 })`);
  await expect(page.getByRole("heading", { name: "zSol is locked" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Locked after 1 minute with nobody using it.")).toBeVisible();
});

test("a send in progress holds the lock back", async ({ context, extensionId }) => {
  const page = await connected(context, extensionId);
  await page.evaluate(`chrome.storage.local.set({ "lock-after": 1 })`);
  await page.evaluate(
    `chrome.storage.session.set({ "active-at": Date.now() - 2 * 60_000, "busy-since": Date.now() })`,
  );
  await page.waitForTimeout(16_000);
  await expect(page.getByRole("button", { name: "Lock zSol" })).toBeVisible();
});

test("a locked panel connects again with a fresh code, or forgets the account", async ({
  context,
  extensionId,
}) => {
  const page = await connected(context, extensionId);
  await page.getByRole("button", { name: "Lock zSol" }).click();
  await page.getByRole("button", { name: "Connect with a code" }).click();
  await expect(page.getByRole("heading", { name: "Connect your zSol account" })).toBeVisible();
  const code = await page.getByRole("status").textContent();
  const zsol = await zsolPage(context);
  expect(await pair(zsol, extensionId, code ?? "")).toMatchObject({ seal: { ok: true } });
  await expect(page.getByRole("button", { name: "Lock zSol" })).toBeVisible();

  await page.getByRole("button", { name: "Lock zSol" }).click();
  await page.getByRole("button", { name: "Forget this account in the panel" }).click();
  await expect(page.getByRole("heading", { name: "Connect your zSol account" })).toBeVisible();
  const kept: unknown = await page.evaluate("chrome.storage.local.get(null)");
  expect(kept).not.toHaveProperty("paired");
});

test("Chrome forgetting its session storage leaves the panel locked", async ({
  context,
  extensionId,
}) => {
  const page = await connected(context, extensionId);
  await page.evaluate("chrome.storage.session.clear()");
  await expect(page.getByRole("heading", { name: "zSol is locked" })).toBeVisible();
  await expect(
    page.getByText("Chrome forgets the open wallet when it restarts or zSol updates."),
  ).toBeVisible();
});
