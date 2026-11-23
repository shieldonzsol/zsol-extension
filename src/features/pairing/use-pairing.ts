import { useEffect } from "react";
import { browser } from "wxt/browser";

import { ZSOL_ORIGINS } from "@/manifest";
import { connect } from "@/features/session/session-store";

import { createPairingHandler } from "./handler";
import { tickets } from "./ticket-store";

export function usePairing() {
  useEffect(() => {
    const handle = createPairingHandler({
      extensionId: browser.runtime.id,
      origins: ZSOL_ORIGINS,
      tickets,
      onPaired: connect,
    });
    const listener = (
      message: unknown,
      sender: { id?: string; origin?: string },
      sendResponse: (reply: unknown) => void,
    ) => {
      void handle(message, sender).then(sendResponse);
      // Answers asynchronously.
      return true;
    };
    browser.runtime.onMessageExternal.addListener(listener);
    return () => browser.runtime.onMessageExternal.removeListener(listener);
  }, []);
}
