// The panel's orders, kept on this device. Each is sealed on disk under a key from the private
// wallet's seed, so nothing about one can be read while the wallet is locked. Every window sees
// every order; the window running one keeps a heartbeat, and an order whose window closed while
// it ran is settled from the chain.
import type { SprClient } from "@heliuslabs/spr/client";
import { address, signature as toSignature } from "@solana/kit";
import { useSyncExternalStore } from "react";
import { browser } from "wxt/browser";

import { randomBytes, seal, unseal, type SealedBox } from "@/features/lock/sealed-bytes";

import {
  canStillLand,
  finishOrder,
  openOrder,
  orderEnded,
  orderIdOf,
  orphanOf,
  pruned,
  sentAs,
  signedWith,
  stepAt,
  stopOrder,
  unsureOrder,
  type Order,
  type OrderFacts,
  type OrderKind,
  type OrderStop,
} from "./order-model";

/** This panel window. */
const RUNNER = orderIdOf(randomBytes(5));
const BEAT_MS = 10_000;
/** A window not heard from for this long has closed. */
const GONE_MS = 30_000;

interface Keeper {
  readonly owner: string;
  readonly key: CryptoKey;
}

let keeper: Keeper | null = null;
let orders: readonly Order[] = [];
let beat: ReturnType<typeof setInterval> | null = null;
let stopWatching: (() => void) | null = null;
const listeners = new Set<() => void>();

function publish(next: readonly Order[]) {
  orders = pruned(next, Date.now());
  for (const listener of listeners) listener();
}

const prefixOf = (owner: string) => `order:${owner}:`;

async function keyOf(seed: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new Uint8Array(seed), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode("zSol panel orders v1"),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function isOrder(value: unknown): value is Order {
  if (typeof value !== "object" || value === null) return false;
  const id: unknown = Reflect.get(value, "id");
  const steps: unknown = Reflect.get(value, "steps");
  const state: unknown = Reflect.get(value, "state");
  const signer: unknown = Reflect.get(value, "signer");
  return (
    typeof id === "string" &&
    Array.isArray(steps) &&
    (state === "running" || state === "done" || state === "stopped" || state === "unsure") &&
    (signer === undefined || typeof signer === "string")
  );
}

async function openBox(holder: Keeper, storeKey: string, box: unknown): Promise<Order | null> {
  if (typeof box !== "object" || box === null) return null;
  const iv: unknown = Reflect.get(box, "iv");
  const sealed: unknown = Reflect.get(box, "sealed");
  if (typeof iv !== "string" || typeof sealed !== "string") return null;
  const plain = await unseal(holder.key, { iv, sealed }, storeKey);
  if (!plain) return null;
  try {
    const order: unknown = JSON.parse(new TextDecoder().decode(plain));
    return isOrder(order) ? order : null;
  } catch {
    return null;
  }
}

async function keep(order: Order): Promise<void> {
  const holder = keeper;
  if (!holder) return;
  const storeKey = `${prefixOf(holder.owner)}${order.id}`;
  const box: SealedBox = await seal(
    holder.key,
    new TextEncoder().encode(JSON.stringify(order)),
    storeKey,
  );
  if (keeper === holder) await browser.storage.local.set({ [storeKey]: box });
}

async function readAll(holder: Keeper): Promise<Order[]> {
  const everything = await browser.storage.local.get(null);
  const prefix = prefixOf(holder.owner);
  const read = await Promise.all(
    Object.entries(everything)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, box]) => openBox(holder, key, box)),
  );
  const kept = read.filter((order): order is Order => order !== null);
  // What is no longer worth keeping leaves the disk too.
  const keepIds = new Set(pruned(kept, Date.now()).map((order) => order.id));
  const gone = kept
    .filter((order) => !keepIds.has(order.id))
    .map((order) => `${prefix}${order.id}`);
  if (gone.length > 0) await browser.storage.local.remove(gone);
  return kept.filter((order) => keepIds.has(order.id));
}

function update(id: string, change: (order: Order) => Order) {
  const before = orders.find((order) => order.id === id);
  if (!before) return;
  const after = change(before);
  if (after === before) return;
  publish(orders.map((order) => (order.id === id ? after : order)));
  void keep(after).catch(() => undefined);
}

function beatNow() {
  void browser.storage.session.set({ [`runner:${RUNNER}`]: Date.now() }).catch(() => undefined);
}

// A closing window says so at once, so another one settles its orders without waiting.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    void browser.storage.session.remove(`runner:${RUNNER}`).catch(() => undefined);
  });
}

/** Reads the private wallet's orders and follows every window's changes. */
export async function openOrders(seed: Uint8Array, owner: string): Promise<void> {
  closeOrders();
  const holder: Keeper = { owner, key: await keyOf(seed) };
  keeper = holder;
  beatNow();
  beat = setInterval(beatNow, BEAT_MS);
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area !== "local" || keeper !== holder) return;
    if (!Object.keys(changes).some((key) => key.startsWith(prefixOf(owner)))) return;
    void readAll(holder).then((read) => {
      if (keeper === holder) publish(read);
    });
  };
  browser.storage.onChanged.addListener(listener);
  stopWatching = () => browser.storage.onChanged.removeListener(listener);
  const read = await readAll(holder);
  if (keeper === holder) publish(read);
}

/** Forgets the orders in this window: the wallet locked or closed. */
export function closeOrders() {
  keeper = null;
  if (beat !== null) clearInterval(beat);
  beat = null;
  stopWatching?.();
  stopWatching = null;
  void browser.storage.session.remove(`runner:${RUNNER}`).catch(() => undefined);
  publish([]);
}

export interface OrderHandle {
  readonly id: string;
  readonly at: (step: string) => void;
  /** The private wallet signed it. */
  readonly signed: (signature: string) => void;
  /** zSol sent it. */
  readonly sent: (signature: string) => void;
  readonly done: () => void;
  readonly stop: (stop: OrderStop) => void;
  /** It may have gone out and the panel can't tell yet: the chain will settle it. */
  readonly unsure: () => void;
}

/** Opens an order for an action that is starting, and keeps it on this device. */
export function startOrder(
  kind: OrderKind,
  facts: OrderFacts,
  steps: readonly string[],
  /** Who signs it, when not the private wallet. */
  signer?: string,
): OrderHandle {
  const order = openOrder({
    id: orderIdOf(randomBytes(5)),
    kind,
    now: Date.now(),
    facts,
    steps,
    runner: RUNNER,
    ...(signer === undefined ? {} : { signer }),
  });
  publish([order, ...orders]);
  void keep(order).catch(() => undefined);
  const { id } = order;
  return {
    id,
    at: (step) => update(id, (each) => stepAt(each, step, Date.now())),
    signed: (signature) => update(id, (each) => signedWith(each, signature, Date.now())),
    sent: (signature) => update(id, (each) => sentAs(each, signature)),
    done: () => update(id, (each) => finishOrder(each, Date.now())),
    stop: (stop) => update(id, (each) => stopOrder(each, Date.now(), stop)),
    unsure: () => update(id, (each) => unsureOrder(each)),
  };
}

async function runnerAlive(runner: string | undefined): Promise<boolean> {
  if (runner === undefined) return false;
  if (runner === RUNNER) return true;
  const key = `runner:${runner}`;
  const found = await browser.storage.session.get(key);
  const at: unknown = found[key];
  return typeof at === "number" && Date.now() - at < GONE_MS;
}

type ChainVerdict = "landed" | "failed" | "unseen";

async function statusOf(client: SprClient, sent: string): Promise<ChainVerdict> {
  const { value } = await client.solanaRpc.getSignatureStatuses([toSignature(sent)]).send();
  const status = value[0];
  if (!status) return "unseen";
  if (status.err) return "failed";
  return status.confirmationStatus === "processed" ? "unseen" : "landed";
}

/** The transaction that carries its signer's signature, among the signer's own recent ones. */
async function findSent(client: SprClient, owner: string, order: Order): Promise<string | null> {
  if (!order.signed || order.signedAt === undefined) return null;
  const since = Math.floor(order.signedAt / 1000) - 60;
  const recent = await client.solanaRpc
    .getSignaturesForAddress(address(order.signer ?? owner), {
      limit: 25,
      commitment: "confirmed",
    })
    .send();
  for (const entry of recent) {
    if (entry.blockTime !== null && Number(entry.blockTime) < since) break;
    // oxlint-disable-next-line no-await-in-loop -- newest first, and it is nearly always the first.
    const found = await client.solanaRpc
      .getTransaction(entry.signature, {
        encoding: "json",
        commitment: "confirmed",
        maxSupportedTransactionVersion: 1,
      })
      .send()
      .catch(() => null);
    const signatures: unknown = found ? Reflect.get(found.transaction, "signatures") : null;
    if (Array.isArray(signatures) && signatures.includes(order.signed)) return entry.signature;
  }
  return null;
}

const NEVER_SENT: OrderStop = {
  title: "It didn't go out. Nothing moved.",
  body: "The panel closed before zSol sent it.",
};
const NEVER_LANDED: OrderStop = {
  title: "It never landed, and it can't any more. Nothing moved.",
  body: "Your private balance is as it was.",
};
const FAILED_ON_CHAIN: OrderStop = {
  title: "It reached Solana and failed there. Nothing moved.",
  body: "Your private balance is as it was.",
};

/**
 * Settles the orders whose window closed while they ran: never signed, nothing went out; signed,
 * the chain says whether it landed, and one never seen past its blockhash's life never will.
 * Returns whether one landed, so the balance is read again.
 */
export async function settleOrphans(client: SprClient, owner: string): Promise<boolean> {
  let landed = false;
  for (const order of orders) {
    if (orderEnded(order)) continue;
    // oxlint-disable-next-line no-await-in-loop -- a few orders at most, each its own reads.
    if (order.state === "running" && (await runnerAlive(order.runner))) continue;
    if (orphanOf(order) === "never-sent") {
      update(order.id, (each) => stopOrder(each, Date.now(), NEVER_SENT));
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- as above.
    const sent = order.signature ?? (await findSent(client, owner, order).catch(() => null));
    // oxlint-disable-next-line no-await-in-loop -- as above.
    const verdict = sent ? await statusOf(client, sent).catch(() => "unseen" as const) : "unseen";
    if (verdict === "landed") {
      landed = true;
      update(order.id, (each) => finishOrder(sent ? sentAs(each, sent) : each, Date.now()));
    } else if (verdict === "failed") {
      update(order.id, (each) =>
        stopOrder(sent ? sentAs(each, sent) : each, Date.now(), FAILED_ON_CHAIN),
      );
    } else if (canStillLand(order, Date.now())) {
      update(order.id, (each) => (sent ? unsureOrder(sentAs(each, sent)) : unsureOrder(each)));
    } else {
      update(order.id, (each) => stopOrder(each, Date.now(), NEVER_LANDED));
    }
  }
  return landed;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const currentOrders = () => orders;

export function useOrders(): readonly Order[] {
  return useSyncExternalStore(subscribe, currentOrders, currentOrders);
}
