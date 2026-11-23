// SLIP-0010 for Ed25519: hardened children only, the only kind Ed25519 has.
const HARDENED = 0x8000_0000;
const CURVE_KEY = new TextEncoder().encode("ed25519 seed");

export interface DerivedKey {
  readonly privateKey: Uint8Array<ArrayBuffer>;
  readonly chainCode: Uint8Array<ArrayBuffer>;
}

async function hmacSha512(
  key: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, data));
}

/** The node at `path` under `seed`, each index below 2^31 and taken hardened. */
export async function deriveEd25519(
  seed: Uint8Array,
  path: readonly number[],
): Promise<DerivedKey> {
  if (seed.length < 16 || seed.length > 64) throw new Error("A seed is 16 to 64 bytes.");
  let node = await hmacSha512(CURVE_KEY, new Uint8Array(seed));
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0 || index >= HARDENED) {
      throw new Error(`Index ${String(index)} is not between 0 and 2^31 - 1.`);
    }
    const data = new Uint8Array(37);
    data.set(node.subarray(0, 32), 1);
    new DataView(data.buffer).setUint32(33, index + HARDENED);
    const parent = node;
    // oxlint-disable-next-line no-await-in-loop -- each child needs its parent.
    node = await hmacSha512(node.slice(32), data);
    parent.fill(0);
    data.fill(0);
  }
  const derived = { privateKey: node.slice(0, 32), chainCode: node.slice(32) };
  node.fill(0);
  return derived;
}
