import { PanelHeader } from "@/components/panel-header";
import { ConnectScreen } from "@/features/pairing/connect-screen";

/** The side panel. Until it holds an account, it shows how to connect one. */
export function App() {
  return (
    <div className="flex h-dvh flex-col">
      <PanelHeader />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <ConnectScreen />
      </main>
    </div>
  );
}
