import { describe, expect, it } from "vitest";

import { siwsMessage } from "./siws";

describe("SIWS message", () => {
  it("is Privy's format, for zsol.cc", () => {
    const address = "AMaJ3pAQNyqGK7DrfW5Cs6cCWKCdk1wcAiFFVZmdnYAg";
    expect(siwsMessage(address, "abc123", new Date("2026-11-23T19:44:51.977Z"))).toBe(
      `zsol.cc wants you to sign in with your Solana account:\n${address}\n\nYou are proving you own ${address}.\n\nURI: https://zsol.cc\nVersion: 1\nChain ID: mainnet\nNonce: abc123\nIssued At: 2026-11-23T19:44:51.977Z\nResources:\n- https://privy.io`,
    );
  });
});
