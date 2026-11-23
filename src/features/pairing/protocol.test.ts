import { describe, expect, it } from "vitest";

import {
  HELLO,
  SEAL,
  newPairingKey,
  openPairing,
  parseMessage,
  sealPairing,
  toBase64,
  type PairingPayload,
} from "./protocol";

const payload: PairingPayload = {
  v: 1,
  wallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  seed: toBase64(new Uint8Array(32).fill(7)),
};
const binding = { code: "K7QX29MD", origin: "https://zsol.cc", extensionId: "abcdefghijklmnop" };

describe("pairing protocol", () => {
  it("opens what was sealed to its key with its binding", async () => {
    const key = await newPairingKey();
    const box = await sealPairing(key.publicKey, payload, binding);
    expect(await openPairing(key, box, binding)).toEqual(payload);
  });

  it("refuses a box bound to another code, page or extension", async () => {
    const key = await newPairingKey();
    const box = await sealPairing(key.publicKey, payload, binding);
    const others = [
      { ...binding, code: "K7QX29ME" },
      { ...binding, origin: "https://zsol.cc.evil.example" },
      { ...binding, extensionId: "ponmlkjihgfedcba" },
    ];
    const opened = await Promise.all(others.map((other) => openPairing(key, box, other)));
    expect(opened).toEqual([null, null, null]);
  });

  it("refuses a box sealed to another key, or changed on the way", async () => {
    const [key, other] = await Promise.all([newPairingKey(), newPairingKey()]);
    const box = await sealPairing(other.publicKey, payload, binding);
    expect(await openPairing(key, box, binding)).toBeNull();

    const mine = await sealPairing(key.publicKey, payload, binding);
    const ct = Uint8Array.from(atob(mine.ct), (char) => char.charCodeAt(0));
    ct[0] = (ct[0] ?? 0) ^ 1;
    expect(await openPairing(key, { ...mine, ct: toBase64(ct) }, binding)).toBeNull();
  });

  it("refuses a payload whose seed isn't 32 bytes", async () => {
    const key = await newPairingKey();
    const short = { ...payload, seed: toBase64(new Uint8Array(31)) };
    expect(
      await openPairing(key, await sealPairing(key.publicKey, short, binding), binding),
    ).toBeNull();
  });

  it("reads only well-formed messages of this version", () => {
    expect(parseMessage({ type: HELLO, v: 1, code: "K7QX-29MD" })).toEqual({
      type: HELLO,
      v: 1,
      code: "K7QX-29MD",
    });
    expect(
      parseMessage({ type: SEAL, v: 1, code: "K7QX29MD", box: { enc: "a", ct: "b" } }),
    ).not.toBeNull();
    expect(parseMessage({ type: HELLO, v: 2, code: "K7QX29MD" })).toBeNull();
    expect(parseMessage({ type: SEAL, v: 1, code: "K7QX29MD", box: { enc: "a" } })).toBeNull();
    expect(parseMessage({ type: HELLO, v: 1, code: "x".repeat(17) })).toBeNull();
    expect(parseMessage("hello")).toBeNull();
    expect(parseMessage(null)).toBeNull();
  });
});
