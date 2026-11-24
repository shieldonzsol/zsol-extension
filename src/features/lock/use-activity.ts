import { useEffect } from "react";

import { isBusy, useBusy } from "./busy";
import { busyNow, idleExpired } from "./lock-rules";
import { lockAll, noteActive, readActive, readBusy, readLockAfter, readPendingLock } from "./vault";

/** Use is noted at most this often. */
const NOTE_EVERY_MS = 15_000;
const CHECK_EVERY_MS = 15_000;

async function lockIfDue() {
  // A send in progress here, or in another window, holds the lock back.
  if (isBusy() || busyNow(await readBusy(), Date.now())) return;
  const pending = await readPendingLock();
  if (pending) {
    await lockAll(pending);
    return;
  }
  const [lastActive, lockAfter] = await Promise.all([readActive(), readLockAfter()]);
  if (idleExpired({ now: Date.now(), lastActive, lockAfter })) await lockAll("idle");
}

/**
 * Notes when the trader uses the panel, and locks on time while it is open: the service worker
 * checks once a minute, this every few seconds. A lock waiting on a send runs once it is done.
 */
function useActivity() {
  const busy = useBusy();

  useEffect(() => {
    let noted = 0;
    const note = () => {
      const now = Date.now();
      if (now - noted < NOTE_EVERY_MS) return;
      noted = now;
      void noteActive().catch(() => undefined);
    };
    const shown = () => {
      if (document.visibilityState === "visible") note();
    };
    note();
    const events = ["pointerdown", "keydown", "wheel"] as const;
    for (const event of events) window.addEventListener(event, note, { passive: true });
    document.addEventListener("visibilitychange", shown);
    const timer = setInterval(() => void lockIfDue().catch(() => undefined), CHECK_EVERY_MS);
    return () => {
      for (const event of events) window.removeEventListener(event, note);
      document.removeEventListener("visibilitychange", shown);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!busy) void lockIfDue().catch(() => undefined);
  }, [busy]);
}

/** Renders nothing: watches use and the lock while the wallet is open. */
export function ActivityWatch() {
  useActivity();
  return null;
}
