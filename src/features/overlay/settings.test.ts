import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, overLimit, settingsOf, spentToday } from "./settings";
import { siteOfUrl } from "./sites";

const SOL = 1_000_000_000n;

describe("the overlay's settings", () => {
  it("fall back field by field to the defaults", () => {
    expect(settingsOf(null)).toEqual(DEFAULT_SETTINGS);
    const read = settingsOf({ ghost: 3, buys: ["100000000", "x", "-1"], sells: [25, 0, 101] });
    expect(read.ghost).toBe(3);
    expect(read.buys).toEqual([100_000_000n]);
    expect(read.sells).toEqual([25]);
    expect(read.perClick).toBe(DEFAULT_SETTINGS.perClick);
  });

  it("never take a click above its cap, nor a day below a click", () => {
    expect(settingsOf({ perClick: String(11n * SOL) }).perClick).toBe(DEFAULT_SETTINGS.perClick);
    const read = settingsOf({ perClick: String(SOL), perDay: String(SOL / 2n) });
    expect(read.perDay).toBe(SOL);
  });

  it("stop a buy over a click's or a day's limit", () => {
    expect(overLimit(DEFAULT_SETTINGS, SOL, 0n)).toBe("per-click");
    expect(overLimit(DEFAULT_SETTINGS, SOL / 4n, 2n * SOL - SOL / 8n)).toBe("per-day");
    expect(overLimit(DEFAULT_SETTINGS, SOL / 4n, 0n)).toBeNull();
  });

  it("count a day's spending in UTC, and start again the next day", () => {
    const now = Date.UTC(2026, 10, 25, 12);
    expect(spentToday({ day: "2026-11-25", lamports: "500" }, now)).toBe(500n);
    expect(spentToday({ day: "2026-11-24", lamports: "500" }, now)).toBe(0n);
  });
});

describe("the overlay's sites", () => {
  it("are known by host over https only", () => {
    expect(siteOfUrl("https://gmgn.ai/sol/token/x")?.id).toBe("gmgn");
    expect(siteOfUrl("https://axiom.trade/meme/abc")?.id).toBe("axiom");
    expect(siteOfUrl("http://gmgn.ai/")).toBeNull();
    expect(siteOfUrl("https://evil.gmgn.ai.example/")).toBeNull();
    expect(siteOfUrl(undefined)).toBeNull();
  });
});
