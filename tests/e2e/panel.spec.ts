import { expect, test } from "./fixtures";

test("the panel offers a one-time code to connect an account", async ({ context, extensionId }) => {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.setViewportSize({ width: 400, height: 720 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await expect(page.getByRole("heading", { name: "Connect your zSol account" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(
    /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
  );
  await expect(page.getByRole("link", { name: "Open zsol.cc to connect" })).toHaveAttribute(
    "href",
    "https://zsol.cc/extension/connect",
  );
  expect(errors).toEqual([]);
});

test("the extension asks Chrome for the side panel, its storage, a timer, the lock state and the tab it opened from", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const manifest: unknown = await page.evaluate("chrome.runtime.getManifest()");
  expect(manifest).toMatchObject({
    permissions: ["sidePanel", "storage", "alarms", "idle", "activeTab"],
    side_panel: { default_path: "sidepanel.html" },
  });
});
