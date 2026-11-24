import { useEffect } from "react";

import { usePlace } from "@/app/places";
import { PlaceTabs } from "@/components/place-tabs";
import { OrdersPlace } from "@/features/orders/orders-place";
import { SendPlace } from "@/features/send/send-place";
import { forgetSend } from "@/features/send/send-store";

import { useReadWhenBack, WalletPlace } from "./wallet-place";
import { closeWallet, openWallet, useWallet } from "./wallet-store";

/** The signed-in panel: the private wallet stays open while you move between places. */
export default function SignedIn({
  seed,
  site,
  signInWallet,
  passkey,
}: {
  readonly seed: Uint8Array;
  readonly site: string;
  readonly signInWallet: string;
  readonly passkey: boolean;
}) {
  const place = usePlace();
  const wallet = useWallet();

  useEffect(() => {
    void openWallet(seed, site);
    return () => {
      closeWallet();
      forgetSend();
    };
  }, [seed, site]);

  useReadWhenBack(wallet);

  return (
    <>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {place === "orders" ? (
          <OrdersPlace site={site} />
        ) : place === "send" ? (
          <SendPlace site={site} signInWallet={signInWallet} />
        ) : (
          <WalletPlace seed={seed} site={site} signInWallet={signInWallet} passkey={passkey} />
        )}
      </main>
      <PlaceTabs current={place} />
    </>
  );
}
