import { PanelHeader } from "@/components/panel-header";
import { ConnectScreen } from "@/features/pairing/connect-screen";
import { usePairing } from "@/features/pairing/use-pairing";
import { ConnectedScreen } from "@/features/session/connected-screen";
import { useSession } from "@/features/session/session-store";

export function App() {
  const session = useSession();
  return (
    <div className="flex h-dvh flex-col">
      <PanelHeader />
      <main className="min-h-0 flex-1 overflow-y-auto">
        {session.kind === "connected" ? <ConnectedScreen wallet={session.wallet} /> : <Pairing />}
      </main>
    </div>
  );
}

// Listens for zsol.cc only while the code is on screen.
function Pairing() {
  usePairing();
  return <ConnectScreen />;
}
