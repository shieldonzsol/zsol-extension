// A stand-in for zsol.cc's connect page: the sending side of pairing, built for the browser.
import { normalizeCode } from "../../src/features/pairing/code";
import { HELLO, SEAL, sealPairing, type PairingPayload } from "../../src/features/pairing/protocol";

declare global {
  interface Window {
    zsolPair?: typeof pair;
  }
}

declare const chrome: {
  runtime: { sendMessage(extensionId: string, message: unknown): Promise<unknown> };
};

async function pair(extensionId: string, typed: string, payload: PairingPayload) {
  const code = normalizeCode(typed) ?? typed;
  const hello = await chrome.runtime.sendMessage(extensionId, { type: HELLO, v: 1, code: typed });
  if (typeof hello !== "object" || hello === null || !("key" in hello)) return { hello };
  const key = hello.key;
  if (typeof key !== "string") return { hello };
  const box = await sealPairing(key, payload, { code, origin: location.origin, extensionId });
  const seal = await chrome.runtime.sendMessage(extensionId, {
    type: SEAL,
    v: 1,
    code: typed,
    box,
  });
  return { hello, seal };
}

window.zsolPair = pair;
