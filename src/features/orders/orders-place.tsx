import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { useNow } from "@/features/wallet/use-now";
import { readAge } from "@/features/wallet/age";
import { useWallet } from "@/features/wallet/wallet-store";
import { cn } from "@/lib/utils";

import { clockOf, type Order } from "./order-model";
import { STATE_WORDS } from "./order-words";
import { useOrders } from "./order-store";
import { orderTitle, OrderTracker } from "./order-tracker";

export function OrdersPlace({ site }: { readonly site: string }) {
  const orders = useOrders();
  const wallet = useWallet();
  const now = useNow(1_000);
  const [opened, setOpened] = useState<string | null>(null);
  const live = orders.filter((order) => order.state === "running" || order.state === "unsure");
  const ended = orders.filter((order) => order.state === "done" || order.state === "stopped");

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="headline text-2xl">Orders</h1>
        <p className="text-sm text-pretty text-muted-foreground">
          Every action from this panel, with its id, until it lands. Kept on this device for a week,
          sealed under your wallet.
        </p>
      </div>
      {wallet.kind !== "open" ? (
        <p className="text-label text-muted-foreground">
          Your orders show once your private wallet is open.
        </p>
      ) : orders.length === 0 ? (
        <section className="flex flex-col gap-1 rounded-[10px] border border-border bg-card p-4">
          <p className="text-sm font-medium">No orders yet.</p>
          <p className="text-label text-pretty text-muted-foreground">
            Each send from this panel shows here with its id, from the moment you confirm it until
            it lands.
          </p>
        </section>
      ) : null}
      {live.map((order) => (
        <OrderTracker key={order.id} order={order} site={site} />
      ))}
      {ended.length > 0 ? (
        <section
          aria-label="Finished"
          className="flex flex-col rounded-[10px] border border-border bg-card"
        >
          {ended.map((order, index) => (
            <div key={order.id} className={cn(index > 0 && "border-t border-border/70")}>
              <button
                type="button"
                aria-expanded={opened === order.id}
                onClick={() => setOpened(opened === order.id ? null : order.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:bg-muted/50"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{orderTitle(order)}</span>
                  <span className="text-label text-muted-foreground">
                    <span className="font-mono" translate="no">
                      {order.id}
                    </span>{" "}
                    · {ageOf(order, now)}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 text-label",
                    order.state === "stopped" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {STATE_WORDS[order.state]}
                </span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    opened === order.id && "rotate-180",
                  )}
                  strokeWidth={1.75}
                />
              </button>
              {opened === order.id ? (
                <div className="px-3 pb-3">
                  <OrderTracker order={order} site={site} />
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function ageOf(order: Order, now: number): string {
  const took = order.endedAt === undefined ? "" : ` in ${clockOf(order.endedAt - order.createdAt)}`;
  return `${readAge(order.createdAt, now)}${took}`;
}
