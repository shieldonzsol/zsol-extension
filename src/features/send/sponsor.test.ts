import { describe, expect, it } from "vitest";

import { readSetup, SetupUnread } from "./sponsor";

const SOL = "11111111111111111111111111111111";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const base = {
  feePayer: "5NtkdbTTkyVTLzVZbqu12oZVFzAQQgXiLiQGuJuHMvhc",
  treasury: "DG3tyoGfCbDRZMHQqLqf8Bxak8n8m8A4ffoxmJ9hEjsg",
  feeAssets: [SOL, USDC],
  canPay: true,
};

describe("zSol's fee terms as the panel reads them", () => {
  it("reads the rate and the least fee per token", () => {
    const setup = readSetup(200, {
      ...base,
      sendFeeBps: 10,
      sendFeeMinimums: { [SOL]: "30000", [USDC]: "5000" },
    });
    expect(setup.sendFeeBps).toBe(10n);
    expect(setup.sendFeeMinimums.get(SOL)).toBe(30_000n);
    expect(setup.sendFeeMinimums.get(USDC)).toBe(5_000n);
    expect(setup.paused).toBeNull();
  });

  it("still reads a zSol that states neither", () => {
    const setup = readSetup(200, base);
    expect(setup.sendFeeBps).toBe(10n);
    expect(setup.sendFeeMinimums.size).toBe(0);
  });

  it("refuses terms above its own caps, whatever zSol answers", () => {
    expect(() => readSetup(200, { ...base, sendFeeBps: 101 })).toThrow(SetupUnread);
    expect(() => readSetup(200, { ...base, sendFeeMinimums: { [SOL]: "1000001" } })).toThrow(
      SetupUnread,
    );
    expect(() => readSetup(200, { ...base, sendFeeMinimums: { [USDC]: "-5" } })).toThrow(
      SetupUnread,
    );
    expect(() => readSetup(200, { ...base, feePayer: "not an address" })).toThrow(SetupUnread);
  });

  it("tells a pause from an unread answer", () => {
    expect(readSetup(503, { error: "unavailable" }).paused).toBe("off");
    expect(readSetup(200, { ...base, canPay: false, paused: "treasury" }).paused).toBe("treasury");
    expect(() => readSetup(500, null)).toThrow(SetupUnread);
  });
});
