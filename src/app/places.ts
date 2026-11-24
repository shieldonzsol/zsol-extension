import {
  ArrowLeftRightIcon,
  ArrowUpRightIcon,
  ListChecksIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { useSyncExternalStore } from "react";

export const PLACES = [
  { id: "wallet", label: "Wallet", icon: WalletIcon },
  { id: "trade", label: "Trade", icon: ArrowLeftRightIcon },
  { id: "send", label: "Send", icon: ArrowUpRightIcon },
  { id: "orders", label: "Orders", icon: ListChecksIcon },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];

export type TabId = (typeof PLACES)[number]["id"];

/** Places reached from a tab's own screen, under that tab. */
const UNDER = {
  unshield: "wallet",
  move: "wallet",
  "pay-many": "send",
  "ghost-pay": "send",
} as const satisfies Record<string, TabId>;

type UnderId = keyof typeof UNDER;

const isUnder = (id: string): id is UnderId => Object.hasOwn(UNDER, id);

export type PlaceId = TabId | UnderId;

export const placeHref = (id: PlaceId) => `#/${id}`;

export function placeFromHash(hash: string): PlaceId {
  const id = hash.replace(/^#\/?/, "");
  if (isUnder(id)) return id;
  return PLACES.find((place) => place.id === id)?.id ?? "wallet";
}

/** The tab a place sits under. */
export function tabOf(place: PlaceId): TabId {
  return isUnder(place) ? UNDER[place] : place;
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function usePlace(): PlaceId {
  return useSyncExternalStore(
    subscribe,
    () => placeFromHash(window.location.hash),
    () => "wallet",
  );
}
