import { describe, expect, it } from "vitest";

import { nextIndex, rowOf } from "./link-api";

const ADDRESS = "2dpntKBqdBik5D9H9QjonBLzvSKzHzqtfY4vwaQug665";
const row = {
  index: 3,
  address: ADDRESS,
  state: "open",
  createdAt: "2026-11-25T10:00:00.000Z",
  arrivesAt: null,
};

describe("the links zSol lists", () => {
  it("reads a listed link", () => {
    expect(rowOf(row)).toEqual({
      index: 3,
      address: ADDRESS,
      state: "open",
      createdAt: Date.parse("2026-11-25T10:00:00.000Z"),
      arrivesAt: null,
    });
    expect(rowOf({ ...row, arrivesAt: 1_800_000_000_000 })?.arrivesAt).toBe(1_800_000_000_000);
  });

  it("drops a row that isn't a link", () => {
    expect(rowOf(null)).toBeNull();
    expect(rowOf({ ...row, index: -1 })).toBeNull();
    expect(rowOf({ ...row, index: 0x8000_0000 })).toBeNull();
    expect(rowOf({ ...row, index: 1.5 })).toBeNull();
    expect(rowOf({ ...row, address: "not an address" })).toBeNull();
    expect(rowOf({ ...row, state: "lost" })).toBeNull();
    expect(rowOf({ ...row, createdAt: "yesterday" })).toBeNull();
    expect(rowOf({ ...row, arrivesAt: "soon" })?.arrivesAt).toBeNull();
  });

  it("takes the number after the highest listed", () => {
    expect(nextIndex([])).toBe(0);
    expect(nextIndex([{ index: 0 }])).toBe(1);
    expect(nextIndex([{ index: 2 }, { index: 7 }, { index: 4 }])).toBe(8);
  });
});
