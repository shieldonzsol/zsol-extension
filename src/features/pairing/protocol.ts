// HPKE (RFC 9180) base mode with a fixed suite: X25519, HKDF-SHA256, AES-256-GCM.
import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";

export const PAIRING_VERSION = 1;

const text = new TextEncoder();

const INFO = text.encode("zSol extension pairing v1");

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});

export interface PairingBinding {
  readonly code: string;
  readonly origin: string;
  readonly extensionId: string;
}

function aadFor(binding: PairingBinding): Uint8Array {
  return text.encode(
    `zsol-pairing/v${PAIRING_VERSION}\n${binding.code}\n${binding.origin}\n${binding.extensionId}`,
  );
}

export interface PairingPayload {
  readonly v: typeof PAIRING_VERSION;
  readonly wallet: string;
  /** Base64, 32 bytes. */
  readonly seed: string;
}

export interface SealedBox {
  readonly enc: string;
  readonly ct: string;
}

export interface PairingKey {
  readonly keyPair: CryptoKeyPair;
  readonly publicKey: string;
}

export async function newPairingKey(): Promise<PairingKey> {
  const keyPair = await suite.kem.generateKeyPair();
  const raw = new Uint8Array(await suite.kem.serializePublicKey(keyPair.publicKey));
  return { keyPair, publicKey: toBase64(raw) };
}

export async function sealPairing(
  publicKey: string,
  payload: PairingPayload,
  binding: PairingBinding,
): Promise<SealedBox> {
  const recipientPublicKey = await suite.kem.deserializePublicKey(fromBase64(publicKey));
  const sealed = await suite.seal(
    { recipientPublicKey, info: INFO },
    text.encode(JSON.stringify(payload)),
    aadFor(binding),
  );
  return { enc: toBase64(new Uint8Array(sealed.enc)), ct: toBase64(new Uint8Array(sealed.ct)) };
}

/** Null unless sealed to this key with this binding. */
export async function openPairing(
  key: PairingKey,
  box: SealedBox,
  binding: PairingBinding,
): Promise<PairingPayload | null> {
  let opened: Uint8Array;
  try {
    opened = new Uint8Array(
      await suite.open(
        { recipientKey: key.keyPair, enc: fromBase64(box.enc), info: INFO },
        fromBase64(box.ct),
        aadFor(binding),
      ),
    );
  } catch {
    return null;
  }
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(opened));
    return isPayload(payload) ? payload : null;
  } catch {
    return null;
  } finally {
    opened.fill(0);
  }
}

function isPayload(value: unknown): value is PairingPayload {
  const { v, wallet, seed } = fields(value);
  return (
    v === PAIRING_VERSION &&
    typeof wallet === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) &&
    typeof seed === "string" &&
    decodedLength(seed) === 32
  );
}

export const HELLO = "zsol/pairing/hello";
export const SEAL = "zsol/pairing/seal";

export interface HelloMessage {
  readonly type: typeof HELLO;
  readonly v: typeof PAIRING_VERSION;
  readonly code: string;
}

export interface SealMessage {
  readonly type: typeof SEAL;
  readonly v: typeof PAIRING_VERSION;
  readonly code: string;
  readonly box: SealedBox;
}

export type Refusal = "wrong-code" | "expired" | "dropped" | "not-allowed" | "malformed";

export type HelloReply =
  | { readonly ok: true; readonly v: typeof PAIRING_VERSION; readonly key: string }
  | { readonly ok: false; readonly reason: Refusal };

export type SealReply = { readonly ok: true } | { readonly ok: false; readonly reason: Refusal };

function fields(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

export function parseMessage(value: unknown): HelloMessage | SealMessage | null {
  const { type, v, code, box } = fields(value);
  if (v !== PAIRING_VERSION || !isText(code, 16)) return null;
  if (type === HELLO) return { type, v, code };
  if (type !== SEAL) return null;
  const { enc, ct } = fields(box);
  if (!isText(enc, 64) || !isText(ct, 1024)) return null;
  return { type, v, code, box: { enc, ct } };
}

// Chrome 133 lacks Uint8Array.toBase64.

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodedLength(value: string): number {
  try {
    return atob(value).length;
  } catch {
    return -1;
  }
}
