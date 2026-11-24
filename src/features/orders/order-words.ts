import type { OrderKind, OrderState } from "./order-model";

export const KIND_WORDS: Record<OrderKind, string> = {
  "send-dark": "Send dark",
  "pay-many": "Pay many",
  unshield: "Unshield",
  move: "Move to private",
  trade: "Trade",
  "ghost-swap": "Ghost swap",
  "ghost-pay": "Ghost pay",
};

export const STEP_WORDS: Readonly<
  Record<string, { readonly active: string; readonly done: string }>
> = {
  build: { active: "Preparing it", done: "Prepared" },
  sign: { active: "Signing in this panel", done: "Signed in this panel" },
  send: { active: "zSol checks it and sends it", done: "Checked and sent by zSol" },
  land: { active: "Waiting for it to land", done: "Landed on Solana" },
  read: { active: "Reading your balance", done: "Balance read" },
};

export const STATE_WORDS: Record<OrderState, string> = {
  running: "In progress",
  done: "Done",
  stopped: "Stopped",
  unsure: "Checking on chain",
};

export const UNSURE_WORDS = {
  title: "It may have gone out.",
  body: "The panel closed or lost its answer while it was being sent. zSol checks the chain and settles it here; it never sends it twice.",
};
