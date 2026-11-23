import { describe, expect, it } from "vitest";

import { manifest } from "../src/manifest";

// A wallet extension's permissions are its attack surface and its store review. These tests make
// any new permission a deliberate change, seen in review, never a side effect.
describe("manifest", () => {
  it("asks only for the side panel", () => {
    expect(manifest.permissions).toEqual(["sidePanel"]);
  });

  it("reaches no website and runs inside none", () => {
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest).not.toHaveProperty("externally_connectable");
    expect(manifest).not.toHaveProperty("web_accessible_resources");
  });

  it("never runs in incognito", () => {
    expect(manifest.incognito).toBe("not_allowed");
  });
});
