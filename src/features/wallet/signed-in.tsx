import { useEffect } from "react";

import { tabOf, usePlace } from "@/app/places";
import { PlaceTabs } from "@/components/place-tabs";
import { MovePlace } from "@/features/move/move-place";
import { forgetMove } from "@/features/move/move-store";
import { forgetPublicMoney } from "@/features/move/public-money";
import { OrdersPlace } from "@/features/orders/orders-place";
import { TradePlace } from "@/features/trade/trade-place";
import { forgetTrade } from "@/features/trade/trade-store";
import { PayManyPlace } from "@/features/pay-many/pay-many-place";
import { forgetPayMany } from "@/features/pay-many/pay-many-store";
import { SendPlace } from "@/features/send/send-place";
import { UnshieldPlace } from "@/features/unshield/unshield-place";
import { forgetSend } from "@/features/send/send-store";
import { forgetUnshield } from "@/features/unshield/unshield-store";

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
      forgetUnshield();
      forgetPayMany();
      forgetMove();
      forgetTrade();
      forgetPublicMoney();
    };
  }, [seed, site]);

  useReadWhenBack(wallet);

  return (
    <>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {place === "pay-many" ? (
          <PayManyPlace site={site} signInWallet={signInWallet} />
        ) : place === "trade" ? (
          <TradePlace site={site} signInWallet={signInWallet} />
        ) : place === "move" ? (
          <MovePlace site={site} signInWallet={signInWallet} />
        ) : place === "unshield" ? (
          <UnshieldPlace site={site} signInWallet={signInWallet} />
        ) : place === "orders" ? (
          <OrdersPlace site={site} />
        ) : place === "send" ? (
          <SendPlace site={site} signInWallet={signInWallet} />
        ) : (
          <WalletPlace seed={seed} site={site} signInWallet={signInWallet} passkey={passkey} />
        )}
      </main>
      <PlaceTabs current={tabOf(place)} />
    </>
  );
}
