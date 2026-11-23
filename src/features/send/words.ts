import type { AmountProblem } from "@/features/rings/amount-input";

import type { FailureKind } from "./outcomes";
import type { SendStep } from "./sponsor";

export const AMOUNT_WORDS: Record<AmountProblem, (symbol: string, decimals: number) => string> = {
  empty: () => "Enter an amount, like 0.5.",
  "not-amount": () => "That isn't an amount. Use digits and a dot, like 0.5.",
  comma: () => "Use a dot for decimals, like 1.5. A comma only groups thousands, like 1,500.",
  decimals: (symbol, decimals) =>
    `${symbol} has at most ${String(decimals)} decimals. Shorten the amount.`,
  zero: () => "The amount must be above zero.",
};

export const STEP_WORDS: Record<SendStep, string> = {
  signing: "Signing in this panel",
  sending: "zSol checks it and sends it",
  confirming: "Waiting for it to land",
  syncing: "Reading your balance",
};

export const STEPS: readonly SendStep[] = ["signing", "sending", "confirming", "syncing"];

export const FAILURE_WORDS: Record<FailureKind, { readonly title: string; readonly body: string }> =
  {
    unconfirmed: {
      title: "It was sent, but it hasn't landed yet.",
      body: "It may still land in the next minute. Check before you try again, so it isn't paid twice.",
    },
    unanswered: {
      title: "The connection dropped while it was being sent.",
      body: "It may have gone through. Check your balance before you try again, so it isn't paid twice.",
    },
    "landed-unsynced": {
      title: "It landed, but your balance hasn't caught up yet.",
      body: "Read your balance again in a moment to see what you hold now.",
    },
    "failed-on-chain": {
      title: "It reached Solana and failed there. Nothing moved.",
      body: "Your private balance is as it was. If zsol.cc spent from it at the same time, the balance now shows what's left. Try again.",
    },
    sanctioned: {
      title: "This can't go through: an address in it is on a sanctions list.",
      body: "zSol checks every address in a payment against the US Treasury's sanctions list (OFAC) and pays for none that's on it. Nothing moved. Pay a different address instead.",
    },
    "signed-out": {
      title: "Your sign-in ended, so zSol can't pay the network fee.",
      body: "Nothing moved. Sign the panel in again, then try again.",
    },
    paused: {
      title: "Private actions are paused right now. Nothing moved.",
      body: "zSol's fee wallet isn't paying network fees at the moment. Your private balance is as it was. Try again in a few minutes.",
    },
    stale: {
      title: "A fee changed while it was being prepared. Nothing moved.",
      body: "Prepare it again with the figures as they are now.",
    },
    busy: {
      title: "Too many requests from here just now. Nothing moved.",
      body: "Wait a moment, then try again.",
    },
    budget: {
      title: "You've reached zSol's limit on private actions for now. Nothing moved.",
      body: "zSol pays the network fee for a set number of private actions per account, so no one account can run its fee wallet dry. Your private balance is as it was.",
    },
    offline: { title: "You're offline. Nothing moved.", body: "Reconnect, then try again." },
    unreachable: {
      title: "zSol couldn't be reached. Nothing moved.",
      body: "Check your connection, then try again.",
    },
    held: {
      title: "Part of your balance is held for a moment. Nothing moved.",
      body: "Your balance covers this, but part of it is held by a send prepared in the last two minutes that never went out, or isn't settled yet.",
    },
    split: {
      title: "This amount spans two parts of your private balance. Nothing moved.",
      body: "One private transaction spends from one part at a time. A smaller amount fits in one.",
    },
    pieces: {
      title: "Your balance is in too many small pieces for one transaction. Nothing moved.",
      body: "A smaller amount takes fewer pieces, and goes through in one transaction.",
    },
    indexer: {
      title: "The network didn't answer while this was prepared. Nothing moved.",
      body: "Your private balance is as it was. Try again in a moment.",
    },
    recipient: {
      title: "This address has no private wallet yet, so it can't be paid privately.",
      body: "Your private balance is as it was. A Dark link reaches anyone: they claim it into a private wallet of their own.",
    },
    failed: {
      title: "It didn't go through. Nothing moved.",
      body: "Your private balance is as it was. Try again.",
    },
  };

/** How zSol's fee on a send reads: the figure when an amount is typed, the terms when not. */
export function feeWords(input: {
  /** The rate as people read it: "0.1%". */
  readonly rate: string;
  /** The token's least fee as people read it, or null when zSol states none. */
  readonly least: string | null;
  /** This send's fee as people read it, or null before an amount is typed. */
  readonly fee: string | null;
  readonly symbol: string;
  /** zSol charges its fee on this token. */
  readonly charged: boolean;
}): string {
  const { rate, least, fee, symbol } = input;
  if (!input.charged) return "zSol pays the network fee.";
  if (least !== null) {
    return fee === null
      ? `zSol's fee is ${rate}, or at least ${least} ${symbol} on a small send. It's paid privately in the same send, and zSol pays the network fee.`
      : `zSol's fee is ${fee} ${symbol}: ${rate}, or zSol's least fee on a small send. It's paid privately in the same send, and zSol pays the network fee.`;
  }
  return fee === null
    ? `zSol's fee is ${rate}, paid privately in the same send. zSol pays the network fee.`
    : `zSol's fee is ${rate}: ${fee} ${symbol}, paid privately in the same send. zSol pays the network fee.`;
}
