import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

// The service worker keeps no state: Chrome stops it after 30 seconds idle. Its one job for now
// is to open the side panel when the toolbar button is pressed.
export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
    console.error("zSol could not open the side panel from the toolbar button", error);
  });
});
