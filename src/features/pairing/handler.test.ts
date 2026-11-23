import { describe, expect, it, vi } from "vitest";

import { checkCode, newTicket, type PairingTicket } from "./code";
import { createPairingHandler, type Tickets } from "./handler";
import { HELLO, SEAL, sealPairing, toBase64, type PairingPayload } from "./protocol";

const EXTENSION = "abcdefghijklmnop";
const ZSOL = { origin: "https://zsol.cc" };
const payload: PairingPayload = {
  v: 1,
  wallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  seed: toBase64(new Uint8Array(32).fill(9)),
};

function setup() {
  let ticket: PairingTicket = newTicket(0);
  const tickets: Tickets = {
    check(typed) {
      const checked = checkCode(ticket, typed, 1);
      ticket = checked.ticket;
      return checked.result;
    },
    current: () => ticket.code,
    spend: () => {
      ticket = newTicket(0);
    },
  };
  const onPaired = vi.fn<(paired: PairingPayload, site: string) => void>();
  const handle = createPairingHandler({
    extensionId: EXTENSION,
    origins: ["https://zsol.cc"],
    tickets,
    onPaired,
  });
  return { handle, onPaired, code: () => ticket.code };
}

async function hello(handle: ReturnType<typeof setup>["handle"], code: string) {
  const reply = await handle({ type: HELLO, v: 1, code }, ZSOL);
  if (!reply.ok) throw new Error(reply.reason);
  if (!("key" in reply)) throw new Error("no key in the reply");
  return reply.key;
}

describe("pairing handler", () => {
  it("hands the account over once, for the right code", async () => {
    const { handle, onPaired, code } = setup();
    const typed = code();
    const key = await hello(handle, typed);
    const box = await sealPairing(key, payload, {
      code: typed,
      origin: ZSOL.origin,
      extensionId: EXTENSION,
    });

    expect(await handle({ type: SEAL, v: 1, code: typed, box }, ZSOL)).toEqual({ ok: true });
    expect(onPaired).toHaveBeenCalledWith(payload, ZSOL.origin);
    expect(await handle({ type: SEAL, v: 1, code: typed, box }, ZSOL)).toEqual({
      ok: false,
      reason: "wrong-code",
    });
    expect(onPaired).toHaveBeenCalledTimes(1);
  });

  it("refuses other extensions and other pages", async () => {
    const { handle, code } = setup();
    const message = { type: HELLO, v: 1, code: code() };
    expect(await handle(message, { id: "another-extension" })).toMatchObject({
      reason: "not-allowed",
    });
    expect(await handle(message, { origin: "https://evil.example" })).toMatchObject({
      reason: "not-allowed",
    });
    expect(await handle(message, {})).toMatchObject({ reason: "not-allowed" });
  });

  it("counts wrong codes and drops the ticket after 5", async () => {
    const { handle } = setup();
    const replies = [];
    for (let i = 0; i < 5; i++)
      replies.push(await handle({ type: HELLO, v: 1, code: "00000000" }, ZSOL));
    expect(replies.map((reply) => (reply.ok ? "ok" : reply.reason))).toEqual([
      "wrong-code",
      "wrong-code",
      "wrong-code",
      "wrong-code",
      "dropped",
    ]);
  });

  it("refuses a box before its key, or bound to another page", async () => {
    const { handle, onPaired, code } = setup();
    const typed = code();
    const other = setup();
    const elsewhere = await sealPairing(await hello(other.handle, other.code()), payload, {
      code: typed,
      origin: ZSOL.origin,
      extensionId: EXTENSION,
    });
    expect(await handle({ type: SEAL, v: 1, code: typed, box: elsewhere }, ZSOL)).toMatchObject({
      reason: "malformed",
    });

    const key = await hello(handle, typed);
    const wrongPage = await sealPairing(key, payload, {
      code: typed,
      origin: "https://zsol.cc.evil.example",
      extensionId: EXTENSION,
    });
    expect(await handle({ type: SEAL, v: 1, code: typed, box: wrongPage }, ZSOL)).toMatchObject({
      reason: "malformed",
    });
    expect(onPaired).not.toHaveBeenCalled();
  });
});
