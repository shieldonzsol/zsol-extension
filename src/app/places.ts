import { ArrowUpRightIcon, ListChecksIcon, WalletIcon, type LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

export const PLACES = [
  { id: "wallet", label: "Wallet", icon: WalletIcon },
  { id: "send", label: "Send", icon: ArrowUpRightIcon },
  { id: "orders", label: "Orders", icon: ListChecksIcon },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];

export type TabId = (typeof PLACES)[number]["id"];

/** Places reached from a tab's own screen, under that tab. */
const UNDER: Readonly<Record<string, TabId>> = { unshield: "wallet" };

export type PlaceId = TabId | "unshield";

export const placeHref = (id: PlaceId) => `#/${id}`;

export function placeFromHash(hash: string): PlaceId {
  const id = hash.replace(/^#\/?/, "");
  if (id === "unshield") return id;
  return PLACES.find((place) => place.id === id)?.id ?? "wallet";
}

/** The tab a place sits under. */
export function tabOf(place: PlaceId): TabId {
  return UNDER[place] ?? (place === "unshield" ? "wallet" : place);
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
