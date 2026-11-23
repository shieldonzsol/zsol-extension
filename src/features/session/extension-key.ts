// The panel's Privy sign-in key: derived from the private wallet's seed, never holds money.
import {
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
  signBytes,
  type SignatureBytes,
} from "@solana/kit";

const INFO = new TextEncoder().encode("zSol extension sign-in key v1");

export interface ExtensionKey {
  readonly address: string;
  readonly sign: (message: Uint8Array) => Promise<SignatureBytes>;
}

export async function extensionKey(seed: Uint8Array): Promise<ExtensionKey> {
  const material = await crypto.subtle.importKey("raw", new Uint8Array(seed), "HKDF", false, [
    "deriveBits",
  ]);
  const bytes = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: INFO },
      material,
      256,
    ),
  );
  const keyPair = await createKeyPairFromPrivateKeyBytes(bytes);
  bytes.fill(0);
  return {
    address: await getAddressFromPublicKey(keyPair.publicKey),
    sign: (message) => signBytes(keyPair.privateKey, message),
  };
}
