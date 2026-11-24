import { expect, test } from "./fixtures";
import { pair, panel, zsolPage } from "./stand-in";

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
