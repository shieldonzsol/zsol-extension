import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

// Chrome stops the worker when idle: it holds no state.
export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
    console.error("zSol could not open the side panel from the toolbar button", error);
  });
});
