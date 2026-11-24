import { describe, expect, it } from "vitest";

import { mintsInUrl } from "./page-token";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const PUMP = "CDBdbNqmrLu1PcgjrFG52yxg71QnFhBZcUE6PSFdbonk";

describe("the token on a page", () => {
  it("reads a known site's token path, after a referral prefix too", () => {
    expect(mintsInUrl(`https://gmgn.ai/sol/token/${BONK}`)[0]).toBe(BONK);
    expect(mintsInUrl(`https://gmgn.ai/sol/token/abcd_${BONK}?chain=sol`)[0]).toBe(BONK);
    expect(mintsInUrl(`https://pump.fun/coin/${PUMP}`)[0]).toBe(PUMP);
    expect(mintsInUrl(`https://birdeye.so/token/${BONK}?chain=solana`)[0]).toBe(BONK);
    expect(mintsInUrl(`https://solscan.io/token/${BONK}`)[0]).toBe(BONK);
  });

  it("takes the side of a swap that isn't SOL", () => {
    expect(mintsInUrl(`https://jup.ag/swap/SOL-${BONK}`)[0]).toBe(BONK);
    expect(
      mintsInUrl(`https://jup.ag/swap/So11111111111111111111111111111111111111112-${BONK}`),
    ).toEqual([BONK]);
  });

  it("finds a mint anywhere else, to be checked, and nothing on other pages", () => {
    expect(mintsInUrl(`https://example.com/x?token=${BONK}`)).toEqual([BONK]);
    expect(mintsInUrl("https://zsol.cc/wallet")).toEqual([]);
    expect(mintsInUrl(`http://gmgn.ai/sol/token/${BONK}`)).toEqual([]);
    expect(mintsInUrl("chrome://extensions")).toEqual([]);
    expect(mintsInUrl("not a url")).toEqual([]);
  });
});
