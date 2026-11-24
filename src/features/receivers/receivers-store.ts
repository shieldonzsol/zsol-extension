// Who this wallet paid, kept on this device sealed under a key from the private wallet's seed:
// offered again as quick picks, and the check against addresses that only look like them.
import { useSyncExternalStore } from "react";
import { browser } from "wxt/browser";

import { seal, unseal, type SealedBox } from "@/features/lock/sealed-bytes";

import { remembered, type Receiver } from "./lookalike";

interface Keeper {
  readonly owner: string;
  readonly key: CryptoKey;
}

let keeper: Keeper | null = null;
let receivers: readonly Receiver[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly Receiver[]) {
  receivers = next;
  for (const listener of listeners) listener();
}

const storeKeyOf = (owner: string) => `receivers:${owner}`;

async function keyOf(seed: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new Uint8Array(seed), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode("zSol panel receivers v1"),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const isReceiver = (value: unknown): value is Receiver =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "address") === "string" &&
  (Reflect.get(value, "kind") === "zsol" || Reflect.get(value, "kind") === "public") &&
  typeof Reflect.get(value, "lastAt") === "number" &&
  typeof Reflect.get(value, "count") === "number";

async function readAll(holder: Keeper): Promise<Receiver[]> {
  const storeKey = storeKeyOf(holder.owner);
  const box: unknown = (await browser.storage.local.get(storeKey))[storeKey];
  if (typeof box !== "object" || box === null) return [];
  const iv: unknown = Reflect.get(box, "iv");
  const sealed: unknown = Reflect.get(box, "sealed");
  if (typeof iv !== "string" || typeof sealed !== "string") return [];
  const plain = await unseal(holder.key, { iv, sealed }, storeKey);
  if (!plain) return [];
  try {
    const read: unknown = JSON.parse(new TextDecoder().decode(plain));
    return Array.isArray(read) ? read.filter(isReceiver) : [];
  } catch {
    return [];
  }
}

export async function openReceivers(seed: Uint8Array, owner: string): Promise<void> {
  const holder: Keeper = { owner, key: await keyOf(seed) };
  keeper = holder;
  const read = await readAll(holder);
  if (keeper === holder) publish(read);
}

export function closeReceivers(): void {
  keeper = null;
  publish([]);
}

/** Notes a receiver paid just now. */
export async function rememberReceiver(address: string, kind: Receiver["kind"]): Promise<void> {
  const holder = keeper;
  if (!holder) return;
  const next = remembered(await readAll(holder), address, kind, Date.now());
  const storeKey = storeKeyOf(holder.owner);
  const box: SealedBox = await seal(
    holder.key,
    new TextEncoder().encode(JSON.stringify(next)),
    storeKey,
  );
  if (keeper !== holder) return;
  await browser.storage.local.set({ [storeKey]: box });
  publish(next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReceivers(): readonly Receiver[] {
  return useSyncExternalStore(
    subscribe,
    () => receivers,
    () => receivers,
  );
}
