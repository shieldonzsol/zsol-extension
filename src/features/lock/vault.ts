// What the panel keeps, and where:
// - local (on disk): which account it is paired with, the seed sealed under its passkey, and the
//   lock time picked. Nothing here opens the wallet by itself.
// - session (in memory, only Chrome's own pages see it): the open wallet. Chrome forgets it when
//   it restarts or zSol updates, and Lock forgets it at once in every window.
import { browser } from "wxt/browser";

import { type LockAfter, lockAfterOf, type LockReason } from "./lock-rules";
import type { SealedSeed } from "./passkey";
import { fromBase64Url, toBase64Url } from "./sealed-bytes";

export interface Paired {
  readonly v: 1;
  /** The sign-in wallet of the account. */
  readonly wallet: string;
  /** The zSol it paired with, whose API it calls. */
  readonly site: string;
}

export interface Opened extends Paired {
  readonly seed: Uint8Array;
}

const KEYS = {
  paired: "paired",
  sealed: "sealed-seed",
  lockAfter: "lock-after",
  passkeyDeclined: "passkey-declined",
  opened: "opened",
  active: "active-at",
  busy: "busy-since",
  locked: "locked-why",
  lockPending: "lock-pending",
} as const;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : null;

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

async function readOne(area: "local" | "session", key: string): Promise<unknown> {
  const found = await browser.storage[area].get(key);
  return found[key];
}

function pairedOf(value: unknown): Paired | null {
  const fields = record(value);
  if (!fields || fields.v !== 1 || !text(fields.wallet) || !text(fields.site)) return null;
  return { v: 1, wallet: fields.wallet, site: fields.site };
}

export const readPaired = async () => pairedOf(await readOne("local", KEYS.paired));

export function openedOf(value: unknown): Opened | null {
  const paired = pairedOf(value);
  const seed = record(value)?.seed;
  if (!paired || !text(seed)) return null;
  const bytes = fromBase64Url(seed);
  return bytes.length === 32 ? { ...paired, seed: bytes } : null;
}

export const readOpened = async () => openedOf(await readOne("session", KEYS.opened));

/** Whether the wallet is open, without reading its seed. */
export const isOpen = async () => record(await readOne("session", KEYS.opened)) !== null;

/** Opens the wallet in every window: the account, remembered, and its seed, in memory. */
export async function writeOpened(opened: Opened): Promise<void> {
  const paired: Paired = { v: 1, wallet: opened.wallet, site: opened.site };
  await browser.storage.local.set({ [KEYS.paired]: paired });
  await browser.storage.session.set({
    [KEYS.opened]: { ...paired, seed: toBase64Url(opened.seed) },
    [KEYS.active]: Date.now(),
  });
  await browser.storage.session.remove([KEYS.locked, KEYS.lockPending]);
}

/** Locks the wallet in every window; the account stays paired. */
export async function lockAll(reason: LockReason): Promise<void> {
  await browser.storage.session.set({ [KEYS.locked]: reason });
  await browser.storage.session.remove([KEYS.opened, KEYS.busy, KEYS.lockPending, KEYS.active]);
}

export async function readLockReason(): Promise<LockReason | null> {
  const reason = await readOne("session", KEYS.locked);
  return reason === "idle" || reason === "screen" || reason === "manual" ? reason : null;
}

/** Forgets the account in the panel: the pairing, the sealed seed and the open wallet. */
export async function forgetAll(): Promise<void> {
  await browser.storage.session.clear();
  await browser.storage.local.remove([KEYS.paired, KEYS.sealed, KEYS.passkeyDeclined]);
}

function sealedOf(value: unknown): SealedSeed | null {
  const fields = record(value);
  if (!fields || fields.v !== 1) return null;
  const { wallet, site, credential, salt, iv, sealed } = fields;
  if (![wallet, site, credential, salt, iv, sealed].every(text)) return null;
  return {
    v: 1,
    wallet: String(wallet),
    site: String(site),
    credential: String(credential),
    salt: String(salt),
    iv: String(iv),
    sealed: String(sealed),
  };
}

export const readSealed = async () => sealedOf(await readOne("local", KEYS.sealed));
export const writeSealed = (sealed: SealedSeed) =>
  browser.storage.local.set({ [KEYS.sealed]: sealed });
export const clearSealed = () => browser.storage.local.remove(KEYS.sealed);

export async function readPasskeyDeclined(): Promise<boolean> {
  return (await readOne("local", KEYS.passkeyDeclined)) === true;
}
export const declinePasskey = () => browser.storage.local.set({ [KEYS.passkeyDeclined]: true });

export const readLockAfter = async (): Promise<LockAfter> =>
  lockAfterOf(await readOne("local", KEYS.lockAfter));
export const writeLockAfter = (minutes: LockAfter) =>
  browser.storage.local.set({ [KEYS.lockAfter]: minutes });

export const noteActive = () => browser.storage.session.set({ [KEYS.active]: Date.now() });

export async function readActive(): Promise<number | null> {
  const at = await readOne("session", KEYS.active);
  return typeof at === "number" ? at : null;
}

/** A send is being signed or sent: locking waits for it. */
export async function noteBusy(busy: boolean): Promise<void> {
  if (busy) await browser.storage.session.set({ [KEYS.busy]: Date.now() });
  else await browser.storage.session.remove(KEYS.busy);
}

export async function readBusy(): Promise<number | null> {
  const since = await readOne("session", KEYS.busy);
  return typeof since === "number" ? since : null;
}

/** The screen locked while a send was in progress: lock once it is done. */
export const notePendingLock = (reason: LockReason) =>
  browser.storage.session.set({ [KEYS.lockPending]: reason });

export async function readPendingLock(): Promise<LockReason | null> {
  const reason = await readOne("session", KEYS.lockPending);
  return reason === "idle" || reason === "screen" || reason === "manual" ? reason : null;
}

/** Calls `onChange` when the open wallet, the pairing or the passkey changes in any window. */
export function watchVault(onChange: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    const keys = Object.keys(changes);
    const watched =
      (area === "session" && (keys.includes(KEYS.opened) || keys.includes(KEYS.locked))) ||
      (area === "local" &&
        (keys.includes(KEYS.paired) ||
          keys.includes(KEYS.sealed) ||
          keys.includes(KEYS.lockAfter)));
    if (watched) onChange();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
