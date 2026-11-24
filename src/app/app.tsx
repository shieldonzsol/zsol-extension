import { lazy, Suspense, type ReactNode } from "react";

import { PanelHeader } from "@/components/panel-header";
import { LockButton } from "@/features/lock/lock-button";
import { LockedScreen } from "@/features/lock/locked-screen";
import { ActivityWatch } from "@/features/lock/use-activity";
import { ConnectScreen } from "@/features/pairing/connect-screen";
import { usePairing } from "@/features/pairing/use-pairing";
import { ConnectedScreen } from "@/features/session/connected-screen";
import { useSession } from "@/features/session/session-store";

// Privy's SDK is large: it loads only once the panel holds an account.
const PrivySession = lazy(() => import("@/features/privy/privy-session"));
// The Rings SDK and its hasher load only once the panel is signed in.
const SignedIn = lazy(() => import("@/features/wallet/signed-in"));

export function App() {
  const session = useSession();
  return (
    <div className="flex h-dvh flex-col">
      <PanelHeader end={session.kind === "connected" ? <LockButton /> : null} />
      {session.kind === "connected" ? <ActivityWatch /> : null}
      {session.kind === "starting" ? (
        <Scroll>{null}</Scroll>
      ) : session.kind === "locked" ? (
        <Scroll>
          <LockedScreen wallet={session.wallet} passkey={session.passkey} reason={session.reason} />
        </Scroll>
      ) : session.kind === "connected" ? (
        <Suspense
          fallback={
            <Scroll>
              <ConnectedScreen wallet={session.wallet} signIn="signing-in" />
            </Scroll>
          }
        >
          <PrivySession seed={session.seed} attempt={session.attempt}>
            {session.signIn === "signed-in" ? (
              <Suspense fallback={<OpeningWallet />}>
                <SignedIn
                  seed={session.seed}
                  site={session.site}
                  signInWallet={session.wallet}
                  passkey={session.passkey}
                />
              </Suspense>
            ) : (
              <Scroll>
                <ConnectedScreen wallet={session.wallet} signIn={session.signIn} />
              </Scroll>
            )}
          </PrivySession>
        </Suspense>
      ) : (
        <Scroll>
          <Pairing />
        </Scroll>
      )}
    </div>
  );
}

function Scroll({ children }: { readonly children: ReactNode }) {
  return <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>;
}

function OpeningWallet() {
  return (
    <Scroll>
      <div className="p-4">
        <output className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-4 text-label text-muted-foreground">
          Opening your private wallet…
        </output>
      </div>
    </Scroll>
  );
}

// Listens for zsol.cc only while the code is on screen.
function Pairing() {
  usePairing();
  return <ConnectScreen />;
}
