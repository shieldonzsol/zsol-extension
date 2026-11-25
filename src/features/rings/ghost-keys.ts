// Ghost wallets: plain Solana wallets for trading in public, made from the one seed zsol.cc handed
// over, the same way zsol.cc makes them.
import {
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
  type Address,
} from "@solana/kit";

import { deriveEd25519 } from "./slip10";

/** The seed's branch for ghost wallets. */
const GHOST_BRANCH = 4;
export const MAX_GHOST_WALLETS = 500;

export interface GhostWallet {
  /** Its number, from 0. */
  readonly index: number;
  readonly address: Address;
  readonly keys: CryptoKeyPair;
}

export async function ghostWallet(seed: Uint8Array, index: number): Promise<GhostWallet> {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_GHOST_WALLETS) {
    throw new Error(`A ghost wallet's number is 0 to ${String(MAX_GHOST_WALLETS - 1)}.`);
  }
  const { privateKey, chainCode } = await deriveEd25519(seed, [GHOST_BRANCH, index]);
  chainCode.fill(0);
  try {
    const keys = await createKeyPairFromPrivateKeyBytes(privateKey);
    return { index, address: await getAddressFromPublicKey(keys.publicKey), keys };
  } finally {
    privateKey.fill(0);
  }
}
