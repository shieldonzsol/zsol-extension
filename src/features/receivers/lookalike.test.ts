import { describe, expect, it } from "vitest";

import { lookalikeOf, recentOf, remembered, type Receiver } from "./lookalike";

const PAID = "KdoNLUukCVa2jKqGhur5QWVe8FFeui4xUzwodWxZet7";
const POISON = "KdoNxxxxCVa2jKqGhur5QWVe8FFeui4xUzwodWxZet7";
const OTHER = "3Dt7hkTp2AKev2KELvZgGrttNiNonwSJSTVGS1Ye1xem";
const known: Receiver[] = [{ address: PAID, kind: "public", lastAt: 1, count: 1 }];

describe("addresses that only look like one you paid", () => {
  it("are found by their ends, and the same address isn't one", () => {
    expect(lookalikeOf(POISON, known)?.address).toBe(PAID);
    expect(lookalikeOf(` ${POISON} `, known)?.address).toBe(PAID);
    expect(lookalikeOf(PAID, known)).toBeNull();
    expect(lookalikeOf(OTHER, known)).toBeNull();
    expect(lookalikeOf("Kdo", known)).toBeNull();
  });
});

describe("receivers kept", () => {
  it("count each payment, keep the newest first and at most twenty", () => {
    const once = remembered([], PAID, "public", 10);
    const twice = remembered(once, PAID, "public", 20);
    expect(twice).toEqual([{ address: PAID, kind: "public", lastAt: 20, count: 2 }]);
    const many = Array.from({ length: 25 }, (_, at) => String(at)).reduce<Receiver[]>(
      (list, address, at) => remembered(list, address, "zsol", at),
      [],
    );
    expect(many).toHaveLength(20);
    expect(many[0]!.address).toBe("24");
    expect(recentOf(twice, "zsol")).toEqual([]);
    expect(recentOf(twice, "public")).toHaveLength(1);
  });
});
