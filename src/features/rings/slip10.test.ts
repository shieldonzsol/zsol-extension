import { describe, expect, it } from "vitest";

import { deriveEd25519 } from "./slip10";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

// SLIP-0010's test vector 1 for ed25519.
describe("SLIP-0010 for Ed25519", () => {
  const seed = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");

  it("matches the specification's vectors", async () => {
    const master = await deriveEd25519(seed, []);
    expect(hex(master.privateKey)).toBe(
      "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7",
    );
    expect(hex(master.chainCode)).toBe(
      "90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb",
    );
    const child = await deriveEd25519(seed, [0]);
    expect(hex(child.privateKey)).toBe(
      "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3",
    );
    const grandchild = await deriveEd25519(seed, [0, 1]);
    expect(hex(grandchild.privateKey)).toBe(
      "b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2",
    );
  });

  it("refuses an index that isn't below 2^31", async () => {
    await expect(deriveEd25519(seed, [0x8000_0000])).rejects.toThrow(/2\^31/);
    await expect(deriveEd25519(seed, [-1])).rejects.toThrow();
  });
});
