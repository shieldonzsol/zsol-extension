// The private wallet and its ghost wallets, all from the one seed zsol.cc handed over, made the
// same way zsol.cc makes them.
import { initializePoseidon, ShieldedKeypair, SigningKey } from "@heliuslabs/spr";
import { bytes32 } from "@heliuslabs/spr/keypair";

export { ghostWallet, MAX_GHOST_WALLETS, type GhostWallet } from "./ghost-keys";

/** The private wallet: its Solana signer, nullifier key and viewing key all come from the seed. */
export async function privateKeypair(seed: Uint8Array): Promise<ShieldedKeypair> {
  if (seed.length !== 32) throw new Error("A private wallet seed is 32 bytes.");
  await initializePoseidon();
  const copy = bytes32(seed);
  try {
    return ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(copy));
  } finally {
    copy.fill(0);
  }
}
