import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/app";
import { startSession } from "@/features/session/session-store";
import "@/styles/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("The side panel page has no #root element.");

// What the panel keeps is read before the first frame, so a locked panel never flashes another screen.
await startSession().catch((error: unknown) => {
  console.error("zSol could not read what the panel keeps", error);
});

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
