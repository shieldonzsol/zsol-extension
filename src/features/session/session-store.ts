import { useSyncExternalStore } from "react";

import { fromBase64, type PairingPayload } from "@/features/pairing/protocol";

// The seed lives in this page's memory only.
export type Session =
  | { readonly kind: "unpaired" }
  | { readonly kind: "connected"; readonly wallet: string; readonly seed: Uint8Array };

let session: Session = { kind: "unpaired" };
const listeners = new Set<() => void>();

function publish(next: Session) {
  session = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const currentSession = () => session;

export function connect(payload: PairingPayload) {
  forget();
  publish({ kind: "connected", wallet: payload.wallet, seed: fromBase64(payload.seed) });
}

export function disconnect() {
  forget();
  publish({ kind: "unpaired" });
}

/** Best effort in a garbage-collected page. */
function forget() {
  if (session.kind === "connected") session.seed.fill(0);
}

export function useSession(): Session {
  return useSyncExternalStore(subscribe, currentSession, currentSession);
}
