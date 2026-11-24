// Whether a send is being signed or sent: Lock and Disconnect wait for it, in every window.
import { useSyncExternalStore } from "react";

import { noteBusy } from "./vault";

let busy = false;
const listeners = new Set<() => void>();

export function setBusy(next: boolean) {
  if (busy === next) return;
  busy = next;
  void noteBusy(next).catch(() => undefined);
  for (const listener of listeners) listener();
}

export const isBusy = () => busy;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBusy(): boolean {
  return useSyncExternalStore(subscribe, isBusy, isBusy);
}
