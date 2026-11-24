// The account the panel holds, and whether its wallet is open. The open wallet lives in Chrome's
// session storage, so every window and a reopened panel share it, and Lock reaches them all.
import { useSyncExternalStore } from "react";

import { busyNow, type LockReason } from "@/features/lock/lock-rules";
import { forgetPasskey, openWithPasskey, sealWithPasskey } from "@/features/lock/passkey";
import {
  clearSealed,
  forgetAll,
  lockAll,
  readBusy,
  readLockReason,
  readOpened,
  readPaired,
  readSealed,
  watchVault,
  writeOpened,
  writeSealed,
} from "@/features/lock/vault";
import { fromBase64, type PairingPayload } from "@/features/pairing/protocol";

export type SignIn = "signing-in" | "signed-in" | "failed";

export type Session =
  /** Reading what the panel keeps: a moment at most. */
  | { readonly kind: "starting" }
  | { readonly kind: "unpaired" }
  | {
      readonly kind: "locked";
      readonly wallet: string;
      readonly site: string;
      /** A passkey on this device opens it. */
      readonly passkey: boolean;
      /** Why it locked, when it is known: after a restart it isn't. */
      readonly reason: LockReason | null;
    }
  | {
      readonly kind: "connected";
      /** The zSol the panel paired with, whose API it calls. */
      readonly site: string;
      readonly wallet: string;
      readonly seed: Uint8Array;
      readonly signIn: SignIn;
      /** Bumped to ask for another sign-in attempt. */
      readonly attempt: number;
      /** A passkey on this device opens it after a lock. */
      readonly passkey: boolean;
    };

let session: Session = { kind: "starting" };
let signOut: (() => Promise<void>) | null = null;
let reads = 0;
const listeners = new Set<() => void>();

function publish(next: Session) {
  const before = session;
  session = next;
  for (const listener of listeners) listener();
  // The seed this page held is no longer needed: wipe it (best effort in a garbage-collected page).
  if (before.kind === "connected" && (next.kind !== "connected" || next.seed !== before.seed)) {
    before.seed.fill(0);
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, at) => byte === b[at]);

/** Reads what the panel keeps and shows it; again whenever another window changes it. */
async function refresh(): Promise<void> {
  reads += 1;
  const read = reads;
  const [opened, paired, sealed, reason] = await Promise.all([
    readOpened(),
    readPaired(),
    readSealed(),
    readLockReason(),
  ]);
  if (read !== reads) {
    opened?.seed.fill(0);
    return;
  }
  const account = opened ?? paired;
  const passkey =
    sealed !== null &&
    account !== null &&
    sealed.wallet === account.wallet &&
    sealed.site === account.site;
  if (opened) {
    if (
      session.kind === "connected" &&
      session.wallet === opened.wallet &&
      session.site === opened.site &&
      sameBytes(session.seed, opened.seed)
    ) {
      opened.seed.fill(0);
      if (session.passkey !== passkey) publish({ ...session, passkey });
      return;
    }
    publish({
      kind: "connected",
      site: opened.site,
      wallet: opened.wallet,
      seed: opened.seed,
      signIn: "signing-in",
      attempt: 0,
      passkey,
    });
    return;
  }
  publish(
    paired
      ? { kind: "locked", wallet: paired.wallet, site: paired.site, passkey, reason }
      : { kind: "unpaired" },
  );
}

let started = false;

/** Reads the panel's state once, then follows every window's changes. */
export function startSession(): Promise<void> {
  if (!started) {
    started = true;
    watchVault(() => void refresh());
  }
  return refresh();
}

/** zsol.cc handed an account over: open it, here and in every window. */
export async function connect(payload: PairingPayload, site: string): Promise<void> {
  const [paired, sealed] = await Promise.all([readPaired(), readSealed()]);
  // Another account: the passkey kept for the last one opens nothing now.
  if (sealed && (paired?.wallet !== payload.wallet || sealed.site !== site)) {
    forgetPasskey(sealed.credential);
    await clearSealed();
  }
  const seed = fromBase64(payload.seed);
  publish({
    kind: "connected",
    site,
    wallet: payload.wallet,
    seed: new Uint8Array(seed),
    signIn: "signing-in",
    attempt: 0,
    passkey: Boolean(sealed && paired?.wallet === payload.wallet && sealed.site === site),
  });
  await writeOpened({ v: 1, wallet: payload.wallet, site, seed });
  seed.fill(0);
}

export function setSignIn(signIn: SignIn) {
  if (session.kind === "connected") publish({ ...session, signIn });
}

export function retrySignIn() {
  if (session.kind === "connected") {
    publish({ ...session, signIn: "signing-in", attempt: session.attempt + 1 });
  }
}

/** Privy's sign-out, once Privy has loaded. */
export function onSignOut(handler: (() => Promise<void>) | null) {
  signOut = handler;
}

/** Locks the wallet in every window, once no send is in progress. */
export async function lock(reason: LockReason = "manual"): Promise<boolean> {
  if (busyNow(await readBusy(), Date.now())) return false;
  await lockAll(reason);
  return true;
}

/** Opens the wallet with this device's passkey: one prompt. Throws `PasskeyError`. */
export async function unlockWithPasskey(): Promise<void> {
  const [paired, sealed] = await Promise.all([readPaired(), readSealed()]);
  if (!paired || !sealed || sealed.wallet !== paired.wallet || sealed.site !== paired.site) {
    await refresh();
    return;
  }
  try {
    const seed = await openWithPasskey(sealed);
    await writeOpened({ v: 1, wallet: paired.wallet, site: paired.site, seed });
    seed.fill(0);
  } catch (error) {
    // This passkey can't open the copy any more: forget the copy, so the panel offers a code.
    if (error instanceof Error && Reflect.get(error, "code") === "unreadable") {
      await clearSealed();
    }
    throw error;
  }
}

/** Keeps the open wallet's seed under a new passkey on this device. Throws `PasskeyError`. */
export async function turnOnPasskey(): Promise<void> {
  if (session.kind !== "connected") return;
  const { wallet, site, seed } = session;
  const before = await readSealed();
  const sealed = await sealWithPasskey({ wallet, site, seed });
  await writeSealed(sealed);
  if (before && before.credential !== sealed.credential) forgetPasskey(before.credential);
}

/** Forgets the passkey kept on this device; the wallet stays as it is. */
export async function turnOffPasskey(): Promise<void> {
  const sealed = await readSealed();
  if (sealed) forgetPasskey(sealed.credential);
  await clearSealed();
}

/** Forgets the account in the panel: the pairing, the passkey copy and the open wallet. */
export async function disconnect(): Promise<void> {
  const sealed = await readSealed();
  if (sealed) forgetPasskey(sealed.credential);
  await forgetAll();
  publish({ kind: "unpaired" });
  await signOut?.().catch(() => undefined);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const currentSession = () => session;

export function useSession(): Session {
  return useSyncExternalStore(subscribe, currentSession, currentSession);
}
