import { describe, expect, it } from "vitest";

import { privateKeypair } from "./keys";
import { codeInText, darkLinkCode, darkLinkSeed, keyOfCode, linkUrl } from "./links";

// zsol.cc pins the same values: a mismatch would make links the site can't take back.
const SEED = new Uint8Array(32).fill(7);

describe("Dark links", () => {
  it("makes the links zsol.cc makes", async () => {
    const links = await Promise.all(
      [0, 1, 0x7fff_ffff].map(async (index) => {
        const key = await darkLinkSeed(SEED, index);
        const code = darkLinkCode(key);
        const wallet = await privateKeypair(key);
        return [code, wallet.shieldedAddress().solanaAddress()];
      }),
    );
    expect(links).toEqual([
      [
        "4sSEpTb75G5X2buC9sDbx1eaRiGhDcDJ6UrYhCqqSyrx",
        "2dpntKBqdBik5D9H9QjonBLzvSKzHzqtfY4vwaQug665",
      ],
      [
        "EHiPgiKZGgUJEusc4UBtZp4y7mkD7FNvb5iESHnttMcP",
        "BqEGQZGmCmzDGJ8ndvNEK1xF9aWfYq7bXG4YyPEnN5xn",
      ],
      [
        "7Z45ezzY4tPkaeRaY8DGLqyZcU1yd4nWNksZpnfmuY56",
        "7bgqC7k4npev83Hr2YfdBcfkiesPJW2t3DTcWB7VkoV4",
      ],
    ]);
    expect(SEED.every((byte) => byte === 7)).toBe(true);
  });

  it("refuses a number outside the key tree", async () => {
    await expect(darkLinkSeed(SEED, -1)).rejects.toThrow(RangeError);
    await expect(darkLinkSeed(SEED, 0x8000_0000)).rejects.toThrow(RangeError);
    await expect(darkLinkSeed(SEED, 1.5)).rejects.toThrow(RangeError);
  });

  it("reads the code from a pasted link or the code alone", () => {
    const code = "4sSEpTb75G5X2buC9sDbx1eaRiGhDcDJ6UrYhCqqSyrx";
    expect(codeInText(linkUrl("https://zsol.cc", code))).toBe(code);
    expect(codeInText(`  ${code}\n`)).toBe(code);
    expect(codeInText(`https://zsol.cc/claim# ${code} `)).toBe(code);
    expect(keyOfCode(code)).toHaveLength(32);
  });

  it("refuses a link that isn't whole", () => {
    const code = "4sSEpTb75G5X2buC9sDbx1eaRiGhDcDJ6UrYhCqqSyrx";
    expect(codeInText("")).toBeNull();
    expect(codeInText("https://zsol.cc/claim#")).toBeNull();
    expect(codeInText("https://zsol.cc/claim")).toBeNull();
    expect(codeInText(code.slice(0, -4))).toBeNull();
    expect(codeInText(`${code}0`)).toBeNull();
    expect(codeInText(`${code}${code}`)).toBeNull();
    expect(() => darkLinkCode(new Uint8Array(31))).toThrow(RangeError);
  });
});
