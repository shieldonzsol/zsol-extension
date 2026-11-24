import { describe, expect, it } from "vitest";

import { busyNow, idleExpired, lockAfterOf, lockAfterWords } from "./lock-rules";

describe("when the wallet locks", () => {
  const now = 10_000_000;

  it("locks once it sat unused for the chosen time", () => {
    expect(idleExpired({ now, lastActive: now - 29 * 60_000, lockAfter: 30 })).toBe(false);
    expect(idleExpired({ now, lastActive: now - 30 * 60_000, lockAfter: 30 })).toBe(true);
    expect(idleExpired({ now, lastActive: now - 61_000, lockAfter: 1 })).toBe(true);
    expect(idleExpired({ now, lastActive: null, lockAfter: 1 })).toBe(false);
  });

  it("waits for a send in progress, but not for ever", () => {
    expect(busyNow(now - 60_000, now)).toBe(true);
    expect(busyNow(now - 6 * 60_000, now)).toBe(false);
    expect(busyNow(null, now)).toBe(false);
  });

  it("takes only the times it offers, 30 minutes otherwise", () => {
    expect(lockAfterOf(240)).toBe(240);
    expect(lockAfterOf(7)).toBe(30);
    expect(lockAfterOf("15")).toBe(30);
    expect(lockAfterWords(1)).toBe("1 minute");
    expect(lockAfterWords(240)).toBe("4 hours");
    expect(lockAfterWords(1440)).toBe("1 day");
  });
});
