// zSol's chip on a trading terminal the trader allowed. It draws in a closed shadow root, reads
// nothing of the page but its address, holds nothing secret, and acts only on the trader's own
// clicks: a click the page makes is refused.
import { browser } from "wxt/browser";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { defineContentScript } from "wxt/utils/define-content-script";

import { OVERLAY_PORT, type ChipNews, type ChipState } from "@/features/overlay/protocol";
import { CHIP_CSS } from "@/features/overlay/chip-style";

export default defineContentScript({
  registration: "runtime",
  cssInjectionMode: "manual",
  async main(ctx) {
    let port: ReturnType<typeof browser.runtime.connect> | null = null;
    let state: ChipState = { kind: "locked" };
    let open = false;
    let status = "";
    let link: string | null = null;
    let busy = false;

    const ui = await createShadowRootUi(ctx, {
      name: "zsol-chip",
      mode: "closed",
      position: "overlay",
      alignment: "bottom-right",
      zIndex: 2147483646,
      isolateEvents: true,
      onMount(root) {
        const style = document.createElement("style");
        style.textContent = CHIP_CSS;
        root.append(style);
        const box = document.createElement("div");
        box.className = "chip";
        root.append(box);
        return box;
      },
    });
    ui.mount();
    const mounted = ui.mounted;
    if (!mounted) return;
    const box: HTMLDivElement = mounted;

    const connect = () => {
      if (port) return port;
      const next = browser.runtime.connect({ name: OVERLAY_PORT });
      next.onMessage.addListener((news: ChipNews) => {
        if (news.news === "state") state = news.state;
        if (news.news === "step") status = news.words;
        if (news.news === "done" || news.news === "stopped") {
          status = news.words;
          link = news.news === "done" ? news.link : null;
          busy = false;
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a runtime port.
          next.postMessage({ ask: "state" });
        }
        draw();
      });
      next.onDisconnect.addListener(() => {
        port = null;
        busy = false;
      });
      port = next;
      return next;
    };
    const ask = (body: unknown) => {
      try {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a runtime port.
        connect().postMessage(body);
      } catch {
        port = null;
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a runtime port.
        connect().postMessage(body);
      }
    };

    const button = (label: string, onClick: () => void, kind = "") => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = label;
      if (kind) element.className = kind;
      element.disabled = busy;
      element.addEventListener("click", (event) => {
        if (!event.isTrusted) {
          status = "A click the page made doesn't trade.";
          draw();
          return;
        }
        onClick();
      });
      return element;
    };

    const swap = (side: "buy" | "sell", index: number) => {
      if (busy) return;
      busy = true;
      status = "Asking zSol…";
      link = null;
      draw();
      ask({ ask: "swap", side, button: index });
    };

    function draw() {
      box.replaceChildren();
      if (state.kind === "off") {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      if (!open) {
        box.append(
          button(
            "zSol",
            () => {
              open = true;
              draw();
            },
            "mark",
          ),
        );
        return;
      }
      const head = document.createElement("div");
      head.className = "head";
      const title = document.createElement("span");
      title.textContent =
        state.kind === "ready" ? `zSol · Ghost ${String(state.ghost + 1)}` : "zSol";
      head.append(
        title,
        button(
          "Close",
          () => {
            open = false;
            draw();
          },
          "quiet",
        ),
      );
      box.append(head);
      if (state.kind === "locked") {
        const line = document.createElement("p");
        line.textContent = "Unlock zSol in its side panel to trade here.";
        box.append(line);
        return;
      }
      const token = document.createElement("p");
      token.className = "token";
      token.textContent = state.token
        ? `${state.token.symbol}${state.held === null ? "" : ` · ${state.held} held`}`
        : "Open a token's page to trade it.";
      box.append(token);
      if (state.sol !== null) {
        const sol = document.createElement("p");
        sol.className = "quiet";
        sol.textContent = `${state.sol} SOL in the ghost wallet`;
        box.append(sol);
      }
      if (state.token) {
        const buys = document.createElement("div");
        buys.className = "row";
        state.buys.forEach((amount, index) => {
          buys.append(button(`Buy ${amount}`, () => swap("buy", index)));
        });
        const sells = document.createElement("div");
        sells.className = "row";
        state.sells.forEach((share, index) => {
          sells.append(button(`Sell ${String(share)}%`, () => swap("sell", index), "sell"));
        });
        box.append(buys, sells);
      }
      if (status) {
        const line = document.createElement("p");
        line.className = "status";
        line.setAttribute("role", "status");
        line.textContent = status;
        if (link) {
          const see = document.createElement("a");
          see.href = link;
          see.target = "_blank";
          see.rel = "noreferrer";
          see.textContent = " See it";
          line.append(see);
        }
        box.append(line);
      }
    }

    draw();
    ask({ ask: "state" });
    let seen = location.href;
    ctx.setInterval(() => {
      if (location.href === seen) return;
      seen = location.href;
      status = "";
      link = null;
      ask({ ask: "state" });
    }, 1000);
    ctx.addEventListener(window, "focus", () => ask({ ask: "state" }));
  },
});
