import { describe, expect, it } from "vitest";

import {
  CODE_LIFETIME_MS,
  MAX_WRONG_TRIES,
  checkCode,
  formatCode,
  newTicket,
  normalizeCode,
} from "./code";

const fixed = (values: number[]) => (bytes: Uint8Array<ArrayBuffer>) => {
  bytes.set(values);
  return bytes;
};

describe("pairing code", () => {
  it("turns 5 random bytes into 8 characters", () => {
    expect(newTicket(0, fixed([0, 0, 0, 0, 0])).code).toBe("00000000");
    expect(newTicket(0, fixed([255, 255, 255, 255, 255])).code).toBe("ZZZZZZZZ");
    expect(newTicket(0, fixed([0x8a, 0x5f, 0x3c, 0x01, 0xe7])).code).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{8}$/,
    );
  });

  it("lives 2 minutes", () => {
    expect(newTicket(1000).expiresAt).toBe(1000 + CODE_LIFETIME_MS);
  });

  it("reads the way a trader types it", () => {
    expect(formatCode("K7QX29MD")).toBe("K7QX-29MD");
    expect(normalizeCode("k7qx-29md")).toBe("K7QX29MD");
    expect(normalizeCode(" K7QX 29MD ")).toBe("K7QX29MD");
    expect(normalizeCode("ABCD-EFOI")).toBe("ABCDEF01");
    expect(normalizeCode("ABCD-EFGU")).toBeNull();
    expect(normalizeCode("ABC")).toBeNull();
  });

  it("accepts the right code until it expires", () => {
    const ticket = newTicket(0, fixed([1, 2, 3, 4, 5]));
    expect(checkCode(ticket, formatCode(ticket.code), 1).result).toBe("ok");
    expect(checkCode(ticket, ticket.code, CODE_LIFETIME_MS).result).toBe("expired");
  });

  it("drops the code after 5 wrong tries, even if the 6th is right", () => {
    let ticket = newTicket(0, fixed([1, 2, 3, 4, 5]));
    const results = [];
    for (let i = 0; i < MAX_WRONG_TRIES; i++) {
      const checked = checkCode(ticket, "00000000", 1);
      results.push(checked.result);
      ticket = checked.ticket;
    }
    expect(results).toEqual(["wrong", "wrong", "wrong", "wrong", "dropped"]);
    expect(checkCode(ticket, ticket.code, 1).result).toBe("dropped");
  });
});
