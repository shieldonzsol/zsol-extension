// Dark links: a one-time private wallet its creator pays, its key carried in the link after the
// `#`, which browsers never send to a server. Each key comes from the creator's seed the way
// zsol.cc makes it, so the creator finds and takes back an unclaimed link on any device.
import { getBase58Decoder, getBase58Encoder } from "@solana/kit";

import { deriveEd25519 } from "./slip10";

/** The seed's branch for Dark links. */
const LINK_BRANCH = 1;
/** Link numbers are hardened indexes: 0 to 2^31 - 1. */
export const MAX_LINK_INDEX = 0x7fff_ffff;
const KEY_BYTES = 32;

/** The key of the creator's link number `index`: a seed for a private wallet of its own. */
export async function darkLinkSeed(seed: Uint8Array, index: number): Promise<Uint8Array> {
  if (!Number.isInteger(index) || index < 0 || index > MAX_LINK_INDEX) {
    throw new RangeError("A link's number is 0 to 2^31 - 1.");
  }
  const { privateKey, chainCode } = await deriveEd25519(seed, [LINK_BRANCH, index]);
  chainCode.fill(0);
  return privateKey;
}

/** A link's key as it travels: base58, after the `#`. */
export function darkLinkCode(key: Uint8Array): string {
  if (key.length !== KEY_BYTES) throw new RangeError("A link's key is 32 bytes.");
  return getBase58Decoder().decode(key);
}

/** The key back from a link's code; null unless it is exactly one whole key. */
export function keyOfCode(code: string): Uint8Array | null {
  try {
    const key = new Uint8Array(getBase58Encoder().encode(code));
    return key.length === KEY_BYTES ? key : null;
  } catch {
    return null;
  }
}

/** The code in what someone pasted: a whole link, or the part after its `#` alone. */
export function codeInText(text: string): string | null {
  const trimmed = text.trim();
  const hash = trimmed.indexOf("#");
  const code = (hash === -1 ? trimmed : trimmed.slice(hash + 1)).trim();
  if (code === "") return null;
  const key = keyOfCode(code);
  if (!key) return null;
  key.fill(0);
  return code;
}

/** Where a link opens: zsol.cc's claim page, the key after the `#`. */
export const linkUrl = (site: string, code: string) => `${site}/claim#${code}`;
