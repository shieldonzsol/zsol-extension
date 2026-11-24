import { ArrowUpRightIcon, ListChecksIcon, WalletIcon, type LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

export const PLACES = [
  { id: "wallet", label: "Wallet", icon: WalletIcon },
  { id: "send", label: "Send", icon: ArrowUpRightIcon },
  { id: "orders", label: "Orders", icon: ListChecksIcon },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];

export type PlaceId = (typeof PLACES)[number]["id"];

export const placeHref = (id: PlaceId) => `#/${id}`;

export function placeFromHash(hash: string): PlaceId {
  const id = hash.replace(/^#\/?/, "");
  return PLACES.find((place) => place.id === id)?.id ?? "wallet";
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
