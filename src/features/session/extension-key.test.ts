import { address, getPublicKeyFromAddress, verifySignature } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { extensionKey } from "./extension-key";

describe("extension key", () => {
  it("is the key zsol.cc links for this seed", async () => {
    const key = await extensionKey(new Uint8Array(32).fill(7));
    expect(key.address).toBe("EGnd8nHWyBFMwJNgyHvL4JKoN2DWBzEjHtF2EFPVESiZ");
  });

  it("signs a message its address verifies", async () => {
    const key = await extensionKey(new Uint8Array(32).fill(7));
    const message = new TextEncoder().encode("sign in");
    const signature = await key.sign(message);
    const publicKey = await getPublicKeyFromAddress(address(key.address));
    expect(await verifySignature(publicKey, signature, message)).toBe(true);
  });
});
