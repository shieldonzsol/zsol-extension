// What the zSol address holds in public, read for the wallet's card: what a trade left there, or
// what someone sent to it from outside zSol. Read again whenever the private balance is.
import { useSyncExternalStore } from "react";

import { publicMoneyOf, REGISTRY_RECORD_SPACE, type PublicMoney } from "@/features/rings/sweep";
import { spending } from "@/features/wallet/wallet-store";

export interface PublicView {
  /** The last read; null before the first. */
  readonly money: PublicMoney | null;
  readonly reading: boolean;
  /** The last read got no answer: what the address holds now isn't known. */
  readonly unread: boolean;
  /** A move also creates the private wallet's record, at this rent, until it has one. */
  readonly registryRent: bigint | null;
}

const EMPTY: PublicView = { money: null, reading: false, unread: false, registryRent: null };

let view: PublicView = EMPTY;
let turn = 0;
const listeners = new Set<() => void>();

function publish(next: PublicView) {
  view = next;
  for (const listener of listeners) listener();
}

export async function readPublicMoney(registered: boolean | null): Promise<void> {
  const open = spending();
  if (!open) return;
  turn += 1;
  const at = turn;
  publish({ ...view, reading: true });
  const owner = open.spender.keypair.shieldedAddress().solanaAddress();
  try {
    const [money, registryRent] = await Promise.all([
      publicMoneyOf(open.client, owner),
      registered === false
        ? open.client.solanaRpc.getMinimumBalanceForRentExemption(REGISTRY_RECORD_SPACE).send()
        : Promise.resolve(null),
    ]);
    if (at === turn) publish({ money, reading: false, unread: false, registryRent });
  } catch {
    if (at === turn) publish({ ...view, reading: false, unread: true });
  }
}

/** Forgets it: the wallet closed. */
export function forgetPublicMoney(): void {
  turn += 1;
  publish(EMPTY);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePublicMoney(): PublicView {
  return useSyncExternalStore(
    subscribe,
    () => view,
    () => view,
  );
}
