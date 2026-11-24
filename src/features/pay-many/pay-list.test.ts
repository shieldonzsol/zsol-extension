import { getAddressDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { MAX_PAYEES, parsePayList, splitPayments, withoutAddresses, withoutLine } from "./pay-list";

const A = "CjGmj44FNunTsPBg28M3j4skJosYUtuYrYhULoNzGyHs";
const B = "3Dt7hkTp2AKev2KELvZgGrttNiNonwSJSTVGS1Ye1xem";
const OWN = "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB";

describe("Pay many's list", () => {
  it("reads lines in every common shape, a CSV header skipped", () => {
    const list = parsePayList(`address,amount\n${A}, 0.5\n\n"${B}";"1,500"`, 6, OWN);
    expect(list).toEqual({
      ok: true,
      rows: [
        { address: A, amount: 500_000n, line: 2 },
        { address: B, amount: 1_500_000_000n, line: 4 },
      ],
    });
  });

  it("names every bad line, the first one first", () => {
    const list = parsePayList(`${A} 0,5\nnot-an-address 1\n${A} 1\n${OWN} 1\n${B}`, 9, OWN);
    expect(list).toEqual({ ok: false, problem: "comma", line: 1, also: [2, 4, 5] });
    expect(parsePayList(`${A} 1\n${A} 2`, 9, OWN)).toMatchObject({ problem: "twice", line: 2 });
    expect(parsePayList(`${A} 1 2`, 9, OWN)).toMatchObject({ problem: "format", line: 1 });
    expect(parsePayList("\n\n", 9, OWN)).toEqual({ ok: false, problem: "empty" });
  });

  it("pays at most 14 at once, and splits a longer list", () => {
    const addresses = Array.from({ length: MAX_PAYEES + 1 }, (_, at) =>
      getAddressDecoder().decode(new Uint8Array(32).fill(at + 1)),
    );
    const lines = addresses.map((address, at) => `${address} ${String(at + 1)}`);
    expect(parsePayList(lines.join("\n"), 9, OWN)).toEqual({
      ok: false,
      problem: "too-many",
      count: MAX_PAYEES + 1,
    });
    const { first, rest } = splitPayments(lines.join("\n"), MAX_PAYEES);
    expect(parsePayList(first, 9, OWN)).toMatchObject({ ok: true });
    expect(rest).toBe(lines.at(-1));
  });

  it("drops a line or the lines paying some addresses", () => {
    expect(withoutLine(`${A} 1\n${B} 2`, 1)).toBe(`${B} 2`);
    expect(withoutAddresses(`${A} 1\n${B} 2\n"${A}",3`, [A])).toBe(`${B} 2`);
  });
});
