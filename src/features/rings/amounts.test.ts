import { describe, expect, it } from "vitest";

import { formatAbout, formatAmount, formatShown } from "./amounts";

describe("amounts", () => {
  it("shows every decimal when exact", () => {
    expect(formatAmount(1_234_500_000_000n, 9)).toBe("1,234.5");
    expect(formatAmount(0n, 9)).toBe("0");
    expect(formatAmount(1n, 6)).toBe("0.000001");
  });

  it("rounds a card's figure down and never shows dust as zero", () => {
    expect(formatShown(48_899_999n, 9, 4)).toBe("0.0488");
    expect(formatShown(3_959_999n, 6, 2)).toBe("3.95");
    expect(formatShown(10n, 9, 4)).toBe("<0.0001");
    expect(formatShown(0n, 9, 4)).toBe("0");
  });

  it("rounds an about figure to the nearest", () => {
    expect(formatAbout(1_850_000n, 9, 4)).toBe("0.0019");
    expect(formatAbout(3_960_000n, 9, 4)).toBe("0.004");
    expect(formatAbout(0n, 9, 4)).toBe("0");
  });
});
