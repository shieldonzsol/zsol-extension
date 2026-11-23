import { useSyncExternalStore } from "react";

import { fromBase64, type PairingPayload } from "@/features/pairing/protocol";

export type SignIn = "signing-in" | "signed-in" | "failed";

// The seed lives in this page's memory only.
export type Session =
  | { readonly kind: "unpaired" }
  | {
      readonly kind: "connected";
      readonly wallet: string;
      readonly seed: Uint8Array;
      readonly signIn: SignIn;
      /** Bumped to ask for another sign-in attempt. */
      readonly attempt: number;
    };

let session: Session = { kind: "unpaired" };
let signOut: (() => Promise<void>) | null = null;
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
  publish({
    kind: "connected",
    wallet: payload.wallet,
    seed: fromBase64(payload.seed),
    signIn: "signing-in",
    attempt: 0,
  });
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

export async function disconnect() {
  forget();
  publish({ kind: "unpaired" });
  await signOut?.().catch(() => undefined);
}

/** Best effort in a garbage-collected page. */
function forget() {
  if (session.kind === "connected") session.seed.fill(0);
}

export function useSession(): Session {
  return useSyncExternalStore(subscribe, currentSession, currentSession);
}
