import { describe, expect, it } from "vitest";

import { manifestFor } from "../src/manifest";

describe("manifest", () => {
  const manifest = manifestFor("production");

  it("asks only for the side panel", () => {
    expect(manifest.permissions).toEqual(["sidePanel"]);
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
    ]);
  });

  it("never runs in incognito", () => {
    expect(manifest.incognito).toBe("not_allowed");
  });
});
