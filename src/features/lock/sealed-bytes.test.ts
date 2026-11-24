import { describe, expect, it } from "vitest";

import { fromBase64Url, seal, toBase64Url, unseal } from "./sealed-bytes";

const key = () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);

describe("sealed bytes", () => {
  it("opens with the same key and facts only", async () => {
    const one = await key();
    const plain = new Uint8Array(32).fill(7);
    const box = await seal(one, plain, "wallet A");
    expect(await unseal(one, box, "wallet A")).toEqual(plain);
    expect(await unseal(one, box, "wallet B")).toBeNull();
    expect(await unseal(await key(), box, "wallet A")).toBeNull();
  });

  it("refuses a changed box", async () => {
    const one = await key();
    const box = await seal(one, new Uint8Array(32).fill(7), "facts");
    const bytes = fromBase64Url(box.sealed);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    expect(await unseal(one, { ...box, sealed: toBase64Url(bytes) }, "facts")).toBeNull();
    expect(await unseal(one, { ...box, iv: "short" }, "facts")).toBeNull();
  });

  it("writes base64url both ways", () => {
    const bytes = Uint8Array.from([251, 255, 0, 62, 63]);
    expect(toBase64Url(bytes)).not.toMatch(/[+/=]/);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });
});
