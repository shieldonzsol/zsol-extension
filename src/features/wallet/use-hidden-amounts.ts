import { useSyncExternalStore } from "react";

// A per-browser choice, for sharing a screen: kept if storage allows, forgotten if not.
const KEY = "zsol:amounts-hidden";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let hidden = read();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setAmountsHidden(next: boolean) {
  hidden = next;
  try {
    if (next) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Kept for this page only.
  }
  for (const listener of listeners) listener();
}

export function useAmountsHidden(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hidden,
    () => hidden,
  );
}
