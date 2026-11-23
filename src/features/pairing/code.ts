// Crockford base 32 (no I, L, O or U): 8 characters, 40 bits.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const CODE_LIFETIME_MS = 2 * 60 * 1000;

export const MAX_WRONG_TRIES = 5;

export interface PairingTicket {
  readonly code: string;
  readonly expiresAt: number;
  readonly wrongTries: number;
}

export type CodeCheck = "ok" | "wrong" | "expired" | "dropped";

export function newTicket(
  now: number,
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = (bytes) =>
    crypto.getRandomValues(bytes),
): PairingTicket {
  return {
    code: encode(random(new Uint8Array(5))),
    expiresAt: now + CODE_LIFETIME_MS,
    wrongTries: 0,
  };
}

function encode(bytes: Uint8Array): string {
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let code = "";
  for (let shift = 35n; shift >= 0n; shift -= 5n) code += ALPHABET[Number((bits >> shift) & 31n)];
  return code;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Crockford decoding: case, spaces and hyphens ignored, O as 0, I and L as 1. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (code.length !== 8) return null;
  for (const char of code) if (!ALPHABET.includes(char)) return null;
  return code;
}

/** Constant time. */
function sameCode(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** A wrong code counts against the ticket. */
export function checkCode(
  ticket: PairingTicket,
  typed: string,
  now: number,
): { readonly result: CodeCheck; readonly ticket: PairingTicket } {
  if (ticket.wrongTries >= MAX_WRONG_TRIES) return { result: "dropped", ticket };
  if (now >= ticket.expiresAt) return { result: "expired", ticket };
  const code = normalizeCode(typed);
  if (code !== null && sameCode(code, ticket.code)) return { result: "ok", ticket };
  const counted = { ...ticket, wrongTries: ticket.wrongTries + 1 };
  return { result: counted.wrongTries >= MAX_WRONG_TRIES ? "dropped" : "wrong", ticket: counted };
}
