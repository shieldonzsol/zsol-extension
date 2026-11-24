// Bytes sealed with AES-256-GCM under a key that never leaves Web Crypto. What the sealed bytes
// belong to is bound as associated data, so a copy moved to another account doesn't open.

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64Url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const plain = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(plain.length);
  for (let at = 0; at < plain.length; at++) bytes[at] = plain.charCodeAt(at);
  return bytes;
}

export interface SealedBox {
  readonly iv: string;
  readonly sealed: string;
}

const IV_BYTES = 12;

export async function seal(key: CryptoKey, plain: Uint8Array, facts: string): Promise<SealedBox> {
  const iv = randomBytes(IV_BYTES);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(facts) },
    key,
    new Uint8Array(plain),
  );
  return { iv: toBase64Url(iv), sealed: toBase64Url(new Uint8Array(sealed)) };
}

/** The plain bytes, or null when the key, the facts or the box don't match. */
export async function unseal(
  key: CryptoKey,
  box: SealedBox,
  facts: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const iv = fromBase64Url(box.iv);
    if (iv.length !== IV_BYTES) return null;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(facts) },
      key,
      fromBase64Url(box.sealed),
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}
