import { getBase58Decoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { ghostWallet, privateKeypair } from "./keys";
import { privateWalletStatement } from "./statement";

// zsol.cc pins the same values: a mismatch would show a trader other wallets than on the site.
const SEED = new Uint8Array(32).fill(7);

describe("the wallets a seed opens", () => {
  it("opens the private wallet zsol.cc opens", async () => {
    const shielded = (await privateKeypair(SEED)).shieldedAddress();
    expect(shielded.solanaAddress()).toBe("GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB");
    expect(getBase58Decoder().decode(shielded.toBytes())).toBe(
      "yjJFUJ121AUn7hPEuvQyFvY6jgKBQXtTaZ74Y8t7M64f3rpXB5PevHV2vuMPmREqCbyKtJDaNzRAw3VQkeTSpTWx3STadjHF6rJwJQ3ZjtNRqg1JAASVCpNESXcPuxQkwhHcvV",
    );
    expect(SEED.every((byte) => byte === 7)).toBe(true);
  });

  it("makes the ghost wallets zsol.cc makes", async () => {
    const ghosts = await Promise.all([0, 1, 2, 499].map((index) => ghostWallet(SEED, index)));
    expect(ghosts.map((ghost) => ghost.address)).toEqual([
      "CjGmj44FNunTsPBg28M3j4skJosYUtuYrYhULoNzGyHs",
      "3Dt7hkTp2AKev2KELvZgGrttNiNonwSJSTVGS1Ye1xem",
      "DXazv3rKPBZ3LRPdddrMeuYym8ihT2YJAHUT6KBk4Pu7",
      "2BCgisUBXugo3oDdDu2pkx5TtcGmMheYW5JS1CGi7L7r",
    ]);
    expect(ghosts[0]?.keys.privateKey.extractable).toBe(false);
    await expect(ghostWallet(SEED, 500)).rejects.toThrow();
  });

  it("writes the statement zsol.cc checks", () => {
    const text = new TextDecoder().decode(
      privateWalletStatement({ account: "did:privy:a", wallet: "W", shielded: "S", at: 5 }),
    );
    expect(text).toBe(
      "zSol private wallet v1\naccount: did:privy:a\nwallet: W\nshielded: S\nat: 5",
    );
  });
});
