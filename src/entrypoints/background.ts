import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import { busyNow, idleExpired, type LockReason } from "@/features/lock/lock-rules";
import {
  isOpen,
  lockAll,
  notePendingLock,
  readActive,
  readBusy,
  readLockAfter,
  readPaired,
  readPendingLock,
} from "@/features/lock/vault";
import { listenForChips } from "@/features/overlay/background";
import { syncSites } from "@/features/overlay/registration";
import { checkPayouts, PAYOUT_ALARM } from "@/features/payouts/payouts";

const LOCK_CHECK = "lock-check";

/** Locks now, or once the send in progress is done. */
async function lockSoon(reason: LockReason) {
  if (!(await isOpen())) return;
  if (busyNow(await readBusy(), Date.now())) await notePendingLock(reason);
  else await lockAll(reason);
}

async function checkLock() {
  if (!(await isOpen())) return;
  const now = Date.now();
  if (busyNow(await readBusy(), now)) return;
  const pending = await readPendingLock();
  if (pending) {
    await lockAll(pending);
    return;
  }
  const [lastActive, lockAfter] = await Promise.all([readActive(), readLockAfter()]);
  if (idleExpired({ now, lastActive, lockAfter })) await lockAll("idle");
}

// Chrome stops the worker when idle: it holds no state, and every listener is registered at once.
export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
    console.error("zSol could not open the side panel from the toolbar button", error);
  });
  void browser.alarms.create(LOCK_CHECK, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === LOCK_CHECK) void checkLock();
    if (alarm.name === PAYOUT_ALARM) {
      void readPaired().then((paired) => (paired ? checkPayouts(paired.site) : undefined));
    }
  });
  browser.idle.onStateChanged.addListener((state) => {
    if (state === "locked") void lockSoon("screen");
  });
  listenForChips();
  browser.permissions.onRemoved.addListener(() => void syncSites());
  void syncSites();
});
