import { useSyncExternalStore } from "react";

import { MAX_WRONG_TRIES, checkCode, newTicket, type PairingTicket } from "./code";
import type { Tickets } from "./handler";

// In memory only: closing the panel ends the code.
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

const currentTicket = () => ticket;

export function renewIfSpent(now: number) {
  if (now >= ticket.expiresAt || ticket.wrongTries >= MAX_WRONG_TRIES) publish(newTicket(now));
}

export const tickets: Tickets = {
  check(typed) {
    const now = Date.now();
    const checked = checkCode(ticket, typed, now);
    publish(checked.result === "dropped" ? newTicket(now) : checked.ticket);
    return checked.result;
  },
  current: () => ticket.code,
  spend: () => publish(newTicket(Date.now())),
};

export function useTicket(): PairingTicket {
  return useSyncExternalStore(subscribe, currentTicket, currentTicket);
}
