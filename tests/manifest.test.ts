import { describe, expect, it } from "vitest";

import { manifestFor } from "../src/manifest";

describe("manifest", () => {
  const manifest = manifestFor("production");

  it("asks only for the side panel, its storage, the lock's timer, the computer's lock and the tab it opened from", () => {
    expect(manifest.permissions).toEqual(["sidePanel", "storage", "alarms", "idle", "activeTab"]);
  });

  it("reaches no website and runs inside none", () => {
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest).not.toHaveProperty("web_accessible_resources");
  });

  it("hears only from zsol.cc", () => {
    expect(manifest.externally_connectable).toEqual({ matches: ["https://zsol.cc/*"] });
    expect(manifestFor("development").externally_connectable.matches).toEqual([
      "https://zsol.cc/*",
      "https://zsol.localhost/*",
      "http://localhost/*",
    ]);
  });

  it("leaves the id to the store, but fixes it in development", () => {
    expect(manifest).not.toHaveProperty("key");
    expect(manifestFor("development")).toHaveProperty("key");
  });

  it("never runs in incognito", () => {
    expect(manifest.incognito).toBe("not_allowed");
  });

  it("runs only its own scripts, plus WebAssembly from the package", () => {
    expect(manifest.content_security_policy).toEqual({
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    });
  });
});
