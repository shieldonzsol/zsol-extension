import { ArrowDownToLineIcon } from "lucide-react";
import { useEffect } from "react";

import { buttonVariants } from "@/components/ui/button";
import { formatAbout } from "@/features/rings/amounts";
import { holdsMoney } from "@/features/rings/sweep";
import { useAmountsHidden } from "@/features/wallet/use-hidden-amounts";
import { useWallet } from "@/features/wallet/wallet-store";

import { moneyLines } from "./money-words";
import { startMove } from "./move-place";
import { useMove } from "./move-store";
import { readPublicMoney, usePublicMoney } from "./public-money";

/** What the zSol address holds in public, and the way it moves in. Shown while it holds any. */
export function PublicMoneyCard({ signInWallet }: { readonly signInWallet: string }) {
  const wallet = useWallet();
  const shown = usePublicMoney();
  const move = useMove();
  const hidden = useAmountsHidden();
  const open = wallet.kind === "open";
  const readAt = open ? wallet.readAt : null;
  const registered = open ? wallet.registered : null;
  // Read again with every read of the private balance: opening, Read again, after each action.
  useEffect(() => {
    if (readAt !== null) void readPublicMoney(registered);
  }, [readAt, registered]);
  if (!open || !shown.money || !holdsMoney(shown.money)) return null;
  const moving = move.kind === "sending" || (move.kind === "form" && move.preparing);
  return (
    <section
      aria-labelledby="public-money-title"
      className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-4"
    >
      <h2 id="public-money-title" className="text-label font-medium text-muted-foreground">
        Public money at your zSol address
      </h2>
      <ul className="flex flex-col gap-1">
        {moneyLines(shown.money).map((line) => (
          <li key={line.key} className="flex items-baseline justify-between gap-3">
            <span
              className="truncate text-sm text-muted-foreground"
              title={line.mint}
              translate="no"
            >
              {line.symbol}
            </span>
            <span className="shrink-0 text-base font-semibold tabular-nums">
              {hidden ? "Hidden" : line.amount}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-label text-pretty text-muted-foreground">
        Public: what a trade left here, or what someone sent to this address from outside zSol. Move
        it into your private balance: its network fee comes out of this money too.
      </p>
      {shown.registryRent === null ? null : (
        <p className="text-label text-pretty text-warn">
          Moving it also creates your private wallet's record: a one-time rent of about{" "}
          {formatAbout(shown.registryRent, 9, 4)} SOL, paid from this money.
        </p>
      )}
      {shown.unread ? (
        <p className="text-label text-pretty text-muted-foreground">
          Your zSol address couldn't be read again just now: this is what it held last time.
        </p>
      ) : null}
      <button
        type="button"
        disabled={moving}
        onClick={() => startMove(signInWallet)}
        className={buttonVariants({ size: "sm", className: "self-start" })}
      >
        <ArrowDownToLineIcon data-icon="inline-start" strokeWidth={1.75} />
        {moving ? "Moving…" : "Move to private"}
      </button>
    </section>
  );
}
