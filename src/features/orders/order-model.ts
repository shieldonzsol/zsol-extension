// An order: one action from the moment it is confirmed until it lands, with a short id to call it
// by and its steps in order, each with its state and its times. Plain data and plain functions:
// nothing here touches storage, the network or React. Every function returns a new order.

export type OrderKind =
  | "send-dark"
  | "pay-many"
  | "unshield"
  | "move"
  | "trade"
  | "ghost-swap"
  | "ghost-pay"
  | "dark-link"
  | "link-back"
  | "link-claim";

export type StepState = "waiting" | "active" | "done" | "failed";

export interface OrderStep {
  /** Names its words: "sign", "send", "land", "read". */
  readonly key: string;
  readonly state: StepState;
  readonly startedAt?: number;
  readonly endedAt?: number;
}

/**
 * `running`: a step is at work in a panel. `done`. `stopped`: a step failed, or it can no longer
 * land. `unsure`: the panel running it closed after it may have gone out: the chain decides.
 */
export type OrderState = "running" | "done" | "stopped" | "unsure";

/** What an order moves, as its title reads: every value is already as people read it. */
export interface OrderFacts {
  /** "0.5 SOL". */
  readonly amount?: string;
  /** Who gets it, short. */
  readonly to?: string;
  /** How many receivers (Pay many). */
  readonly count?: number;
  /** What a trade brings: "3.95 USDC". */
  readonly gets?: string;
}

export interface OrderStop {
  readonly title: string;
  readonly body?: string;
}

export interface Order {
  /** What it is called by: "K7Q2-M4XD". */
  readonly id: string;
  readonly kind: OrderKind;
  readonly createdAt: number;
  readonly endedAt?: number;
  readonly facts: OrderFacts;
  readonly steps: readonly OrderStep[];
  readonly state: OrderState;
  readonly stop?: OrderStop;
  /** The panel window running it, while it runs. */
  readonly runner?: string;
  /** The private wallet's own signature on it: found on chain even if the panel closed. */
  readonly signed?: string;
  /** Who signs it when not the private wallet: a Dark link's own address, on its claim. */
  readonly signer?: string;
  /** When it was signed: past the blockhash's life it can no longer land. */
  readonly signedAt?: number;
  /** Its transaction, once zSol sent it. */
  readonly signature?: string;
}

/** Crockford's base 32: no I, L, O or U, so an id reads the same aloud and on paper. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** An order's id from 5 bytes: 8 characters in two groups. */
export function orderIdOf(bytes: Uint8Array): string {
  if (bytes.length < 5) throw new RangeError("An order id takes 5 bytes.");
  let bits = 0n;
  for (const byte of bytes.subarray(0, 5)) bits = (bits << 8n) | BigInt(byte);
  let text = "";
  for (let index = 7; index >= 0; index -= 1) {
    text += ALPHABET[Number((bits >> BigInt(index * 5)) & 31n)];
  }
  return `${text.slice(0, 4)}-${text.slice(4)}`;
}

export function openOrder(input: {
  readonly id: string;
  readonly kind: OrderKind;
  readonly now: number;
  readonly facts: OrderFacts;
  readonly steps: readonly string[];
  readonly runner: string;
  readonly signer?: string;
}): Order {
  return {
    id: input.id,
    kind: input.kind,
    createdAt: input.now,
    facts: input.facts,
    state: "running",
    runner: input.runner,
    steps: input.steps.map((key): OrderStep => ({ key, state: "waiting" })),
    ...(input.signer === undefined ? {} : { signer: input.signer }),
  };
}

export const orderEnded = (order: Order) => order.state === "done" || order.state === "stopped";

/** The order is at step `key` now: every step before it is done, and it is at work. */
export function stepAt(order: Order, key: string, now: number): Order {
  const index = order.steps.findIndex((step) => step.key === key);
  if (index < 0 || orderEnded(order)) return order;
  return {
    ...order,
    state: "running",
    steps: order.steps.map((step, at): OrderStep => {
      if (at < index && step.state !== "done") {
        return { ...step, state: "done", startedAt: step.startedAt ?? now, endedAt: now };
      }
      if (at === index && step.state !== "active") {
        return { ...step, state: "active", startedAt: now };
      }
      return step;
    }),
  };
}

/** The private wallet signed it: what finds it on chain later. */
export const signedWith = (order: Order, signed: string, now: number): Order => ({
  ...order,
  signed,
  signedAt: now,
});

/** zSol sent it: its transaction. */
export const sentAs = (order: Order, signature: string): Order => ({ ...order, signature });

/** It landed and every step is done. */
export function finishOrder(order: Order, now: number): Order {
  const { runner: _runner, ...rest } = order;
  return {
    ...rest,
    state: "done",
    endedAt: now,
    steps: order.steps.map((step): OrderStep =>
      step.state === "done"
        ? step
        : { ...step, state: "done", startedAt: step.startedAt ?? now, endedAt: now },
    ),
  };
}

/** A step failed, or it can no longer land: the one at work, or the first still waiting. */
export function stopOrder(order: Order, now: number, stop: OrderStop): Order {
  let at = order.steps.findIndex((step) => step.state === "active");
  if (at < 0) at = order.steps.findIndex((step) => step.state === "waiting");
  const { runner: _runner, ...rest } = order;
  return {
    ...rest,
    state: "stopped",
    endedAt: now,
    stop,
    steps: order.steps.map((step, index): OrderStep =>
      index === at ? { ...step, state: "failed", endedAt: now } : step,
    ),
  };
}

/** The panel running it is gone, and it may have gone out: the chain will say. */
export function unsureOrder(order: Order): Order {
  const { runner: _runner, ...rest } = order;
  return { ...rest, state: "unsure" };
}

/** A transaction's blockhash lives about 150 slots: past this, one never seen can't land. */
export const CAN_LAND_MS = 3 * 60_000;

/** What became of an order whose panel closed while it ran, from what can be known of it. */
export type Orphan =
  /** Never signed: nothing could have gone out. */
  | "never-sent"
  /** Signed, and the chain must be asked. */
  | "ask-chain";

export function orphanOf(order: Order): Orphan {
  return order.signed === undefined ? "never-sent" : "ask-chain";
}

/** The chain hasn't seen it: it can still land while its blockhash lives. */
export function canStillLand(order: Order, now: number): boolean {
  return order.signedAt !== undefined && now - order.signedAt < CAN_LAND_MS;
}

export function currentStep(order: Order): OrderStep | null {
  return (
    order.steps.find((step) => step.state === "active" || step.state === "failed") ??
    order.steps.find((step) => step.state === "waiting") ??
    null
  );
}

const two = (value: number) => String(value).padStart(2, "0");

/** "0:42", "1:05:09". */
export function clockOf(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? `${String(hours)}:${two(minutes)}:${two(seconds % 60)}`
    : `${String(minutes)}:${two(seconds % 60)}`;
}

/** The panel keeps this many orders, and none that ended longer ago than this. */
export const KEEP_ORDERS = 40;
export const KEEP_ENDED_MS = 7 * 24 * 60 * 60 * 1000;

/** The orders worth keeping, newest first. */
export function pruned(orders: readonly Order[], now: number): Order[] {
  return orders
    .filter((order) => !orderEnded(order) || now - (order.endedAt ?? now) < KEEP_ENDED_MS)
    .toSorted((a, b) => b.createdAt - a.createdAt)
    .slice(0, KEEP_ORDERS);
}
