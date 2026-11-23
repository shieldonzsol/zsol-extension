import { useSyncExternalStore } from "react";

import { MAX_WRONG_TRIES, checkCode, newTicket, type CodeCheck, type PairingTicket } from "./code";

/**
 * The panel's current pairing code. It lives in this page's memory only: closing the panel ends
 * it, and a new one is made when it expires or is dropped.
 */
let ticket: PairingTicket = newTicket(Date.now());
const listeners = new Set<() => void>();

function publish(next: PairingTicket) {
  ticket = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentTicket(): PairingTicket {
  return ticket;
}

/** A fresh code if the current one has expired or been dropped. */
export function renewIfSpent(now: number) {
  if (now >= ticket.expiresAt || ticket.wrongTries >= MAX_WRONG_TRIES) publish(newTicket(now));
}

/** Checks a code typed on zsol.cc; a wrong one counts, a dropped one is replaced. */
export function checkTyped(typed: string, now: number): CodeCheck {
  const checked = checkCode(ticket, typed, now);
  publish(checked.result === "dropped" ? newTicket(now) : checked.ticket);
  return checked.result;
}

export function useTicket(): PairingTicket {
  return useSyncExternalStore(subscribe, currentTicket, currentTicket);
}
