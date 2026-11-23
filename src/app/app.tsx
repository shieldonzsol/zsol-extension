import { lazy, Suspense } from "react";

import { PanelHeader } from "@/components/panel-header";
import { ConnectScreen } from "@/features/pairing/connect-screen";
import { usePairing } from "@/features/pairing/use-pairing";
import { ConnectedScreen } from "@/features/session/connected-screen";
import { useSession } from "@/features/session/session-store";

// Privy's SDK is large: it loads only once the panel holds an account.
const PrivySession = lazy(() => import("@/features/privy/privy-session"));

export function App() {
  const session = useSession();
  return (
    <div className="flex h-dvh flex-col">
      <PanelHeader />
      <main className="min-h-0 flex-1 overflow-y-auto">
        {session.kind === "connected" ? (
          <Suspense fallback={<ConnectedScreen wallet={session.wallet} signIn="signing-in" />}>
            <PrivySession seed={session.seed} attempt={session.attempt}>
              <ConnectedScreen wallet={session.wallet} signIn={session.signIn} />
            </PrivySession>
          </Suspense>
        ) : (
          <Pairing />
        )}
      </main>
    </div>
  );
}

// Listens for zsol.cc only while the code is on screen.
function Pairing() {
  usePairing();
  return <ConnectScreen />;
}
