import { describe, expect, it } from "vitest";

import { readAge } from "./age";

describe("a read's age", () => {
  const now = Date.UTC(2026, 10, 23, 12);

  it("says it plainly", () => {
    expect(readAge(now - 10_000, now)).toBe("just now");
    expect(readAge(now - 50_000, now)).toBe("1 min ago");
    expect(readAge(now - 4 * 60_000, now)).toBe("4 min ago");
    expect(readAge(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(readAge(now - 2 * 86_400_000, now)).toBe("on Nov 21");
  });

  it("never reads as the future", () => {
    expect(readAge(now + 60_000, now)).toBe("just now");
  });
});
