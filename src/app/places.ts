import { ArrowUpRightIcon, ListChecksIcon, WalletIcon, type LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

export const PLACES = [
  { id: "wallet", label: "Wallet", icon: WalletIcon },
  { id: "send", label: "Send", icon: ArrowUpRightIcon },
  { id: "orders", label: "Orders", icon: ListChecksIcon },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];

export type TabId = (typeof PLACES)[number]["id"];

/** Places reached from a tab's own screen, under that tab. */
const UNDER = { unshield: "wallet", "pay-many": "send" } as const satisfies Record<string, TabId>;

export type PlaceId = TabId | keyof typeof UNDER;

export const placeHref = (id: PlaceId) => `#/${id}`;

export function placeFromHash(hash: string): PlaceId {
  const id = hash.replace(/^#\/?/, "");
  const under = Object.keys(UNDER).find((each) => each === id);
  if (under === "unshield" || under === "pay-many") return under;
  return PLACES.find((place) => place.id === id)?.id ?? "wallet";
}

/** The tab a place sits under. */
export function tabOf(place: PlaceId): TabId {
  return place === "unshield" || place === "pay-many" ? UNDER[place] : place;
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
