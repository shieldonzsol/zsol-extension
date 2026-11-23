import { lazy, Suspense } from "react";

import { PanelHeader } from "@/components/panel-header";
import { ConnectScreen } from "@/features/pairing/connect-screen";
import { usePairing } from "@/features/pairing/use-pairing";
import { ConnectedScreen } from "@/features/session/connected-screen";
import { useSession } from "@/features/session/session-store";

// Privy's SDK is large: it loads only once the panel holds an account.
const PrivySession = lazy(() => import("@/features/privy/privy-session"));
// The Rings SDK and its hasher load only once the panel is signed in.
const WalletPlace = lazy(() => import("@/features/wallet/wallet-place"));

export function App() {
  const session = useSession();
  return (
    <div className="flex h-dvh flex-col">
      <PanelHeader />
      <main className="min-h-0 flex-1 overflow-y-auto">
        {session.kind === "connected" ? (
          <Suspense fallback={<ConnectedScreen wallet={session.wallet} signIn="signing-in" />}>
            <PrivySession seed={session.seed} attempt={session.attempt}>
              {session.signIn === "signed-in" ? (
                <Suspense fallback={<OpeningWallet />}>
                  <WalletPlace
                    seed={session.seed}
                    site={session.site}
                    signInWallet={session.wallet}
                  />
                </Suspense>
              ) : (
                <ConnectedScreen wallet={session.wallet} signIn={session.signIn} />
              )}
            </PrivySession>
          </Suspense>
        ) : (
          <Pairing />
        )}
      </main>
    </div>
  );
}

function OpeningWallet() {
  return (
    <div className="p-4">
      <output className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-4 text-label text-muted-foreground">
        Opening your private wallet…
      </output>
    </div>
  );
}

// Listens for zsol.cc only while the code is on screen.
function Pairing() {
  usePairing();
  return <ConnectScreen />;
}
