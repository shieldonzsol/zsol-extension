/**
 * The one-time code that connects this panel to a zSol account (docs/pairing.md). The panel shows
 * it; the trader types it on zsol.cc in the same browser. It is 8 characters of Crockford's base 32
 * (no I, L, O or U, so nothing reads as something else): 40 random bits, alive 2 minutes, dropped
 * after 5 wrong tries.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** How long a code is good for. */
export const CODE_LIFETIME_MS = 2 * 60 * 1000;

/** Wrong codes a ticket takes before it is dropped. */
export const MAX_WRONG_TRIES = 5;

export interface PairingTicket {
  /** 8 characters from the alphabet above, without the hyphen. */
  readonly code: string;
  readonly expiresAt: number;
  readonly wrongTries: number;
}

export type CodeCheck = "ok" | "wrong" | "expired" | "dropped";

/** A new ticket: a code from the browser's secure random source. */
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

/** 5 bytes are exactly 8 characters of 5 bits. */
function encode(bytes: Uint8Array): string {
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let code = "";
  for (let shift = 35n; shift >= 0n; shift -= 5n) code += ALPHABET[Number((bits >> shift) & 31n)];
  return code;
}

/** "K7QX29MD" as the trader reads it: "K7QX-29MD". */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * What a trader typed, as a code: any case, spaces and hyphens ignored, O read as 0 and I or L as
 * 1 (Crockford's rule). Null when it can't be a code.
 */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (code.length !== 8) return null;
  for (const char of code) if (!ALPHABET.includes(char)) return null;
  return code;
}

/** Compares in time that doesn't depend on where the two codes differ. */
function sameCode(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** Checks a typed code against the ticket. A wrong one counts against it. */
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
