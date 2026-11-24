import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import {
  forgetAll,
  lockAll,
  noteBusy,
  readBusy,
  readLockReason,
  readOpened,
  readPaired,
  readSealed,
  writeOpened,
  writeSealed,
} from "./vault";

const opened = {
  v: 1 as const,
  wallet: "KdoNLUukCVa2jKqGhur5QWVe8FFeui4xUzwodWxZet7",
  site: "https://zsol.cc",
  seed: new Uint8Array(32).fill(7),
};

describe("what the panel keeps", () => {
  beforeEach(() => fakeBrowser.reset());

  it("opens the wallet in memory and remembers the account on disk", async () => {
    await writeOpened(opened);
    expect((await readOpened())?.seed).toEqual(opened.seed);
    expect(await readPaired()).toEqual({ v: 1, wallet: opened.wallet, site: opened.site });
    const local = await fakeBrowser.storage.local.get(null);
    expect(JSON.stringify(local)).not.toContain("seed");
  });

  it("locks every window but keeps the account", async () => {
    await writeOpened(opened);
    await noteBusy(true);
    await lockAll("idle");
    expect(await readOpened()).toBeNull();
    expect(await readBusy()).toBeNull();
    expect(await readLockReason()).toBe("idle");
    expect(await readPaired()).not.toBeNull();
    await writeOpened(opened);
    expect(await readLockReason()).toBeNull();
  });

  it("forgets everything on Disconnect", async () => {
    await writeOpened(opened);
    await writeSealed({
      v: 1,
      wallet: opened.wallet,
      site: opened.site,
      credential: "c",
      salt: "s",
      iv: "i",
      sealed: "x",
    });
    await forgetAll();
    expect(await readOpened()).toBeNull();
    expect(await readPaired()).toBeNull();
    expect(await readSealed()).toBeNull();
  });

  it("refuses a malformed copy rather than opening something else", async () => {
    await fakeBrowser.storage.session.set({ opened: { ...opened, seed: "AAAA" } });
    expect(await readOpened()).toBeNull();
    await fakeBrowser.storage.local.set({ "sealed-seed": { v: 2 } });
    expect(await readSealed()).toBeNull();
  });
});
