// The pieces every private action's screen shares: the token picker, the amount field, the
// review's buttons, the order while it goes out, and every outcome with its next step.
import { ExternalLinkIcon, LoaderCircleIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { placeHref, type PlaceId } from "@/app/places";
import { buttonVariants } from "@/components/ui/button";
import { useOrders } from "@/features/orders/order-store";
import { OrderId, OrderTracker } from "@/features/orders/order-tracker";
import { plainAmount } from "@/features/rings/amount-input";
import { formatAmount, formatShown } from "@/features/rings/amounts";
import { WALLET_ASSETS, type Asset } from "@/features/rings/holdings";
import { retrySignIn } from "@/features/session/session-store";
import { useNow } from "@/features/wallet/use-now";
import { readAgain, useWallet } from "@/features/wallet/wallet-store";
import { cn } from "@/lib/utils";

import type { FailureFacts } from "./outcomes";
import type { Landed } from "./sponsor";
import { FAILURE_WORDS } from "./words";

/** A review older than this may carry a blockhash that no longer lands: prepare it again. */
const REVIEW_STALE_MS = 50_000;

export const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

export function Card({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-[10px] border border-border bg-card p-4",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Heading({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="headline text-2xl">{title}</h1>
      <p className="text-sm text-pretty text-muted-foreground">{body}</p>
    </div>
  );
}

export function ExternalLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
    >
      {children}
      <ExternalLinkIcon data-icon="inline-end" strokeWidth={1.75} />
    </a>
  );
}

/** While the private wallet isn't open: what the place waits for, and the way there. */
export function NotOpenYet({ what }: { readonly what: string }) {
  const wallet = useWallet();
  return (
    <Card>
      <p className="text-sm text-pretty text-muted-foreground">
        {wallet.kind === "refused"
          ? `${what} opens once your private wallet opens. Your wallet tab says why it couldn't.`
          : `${what} opens once your private wallet is open.`}
      </p>
      <PlaceLink place="wallet">Go to your wallet</PlaceLink>
    </Card>
  );
}

export function PlaceLink({
  place,
  children,
}: {
  readonly place: PlaceId;
  readonly children: ReactNode;
}) {
  return (
    <a
      href={placeHref(place)}
      className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
    >
      {children}
    </a>
  );
}

/** What the private balance holds of each token, as the wallet last read it. */
export function useHeld(): (mint: string) => bigint {
  const wallet = useWallet();
  return (mint) =>
    wallet.kind === "open"
      ? (wallet.balances?.find((balance) => balance.asset.mint === mint)?.amount ?? 0n)
      : 0n;
}

export function TokenPicker({
  name,
  picked,
  onPick,
}: {
  readonly name: string;
  readonly picked: Asset;
  readonly onPick: (asset: Asset) => void;
}) {
  const held = useHeld();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-label font-medium text-muted-foreground">Token</legend>
      <div className="grid grid-cols-2 gap-2">
        {WALLET_ASSETS.map((asset) => (
          <label
            key={asset.mint}
            className={cn(
              "flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              asset.mint === picked.mint
                ? "border-primary bg-frost"
                : "border-border hover:bg-muted/50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={asset.mint}
              checked={asset.mint === picked.mint}
              onChange={() => onPick(asset)}
              className="sr-only"
            />
            <span className="text-sm font-medium" translate="no">
              {asset.symbol}
            </span>
            <span className="text-label text-muted-foreground tabular-nums">
              {formatShown(held(asset.mint), asset.decimals, asset.places)} held
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AddressField({
  id,
  noteId,
  label,
  placeholder,
  value,
  onChange,
  invalid,
  note,
  aside,
}: {
  readonly id: string;
  readonly noteId: string;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly invalid: boolean;
  /** What is wrong with it, or what to know about it. */
  readonly note?: ReactNode;
  /** A quick fill beside the label. */
  readonly aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-label font-medium text-muted-foreground">
          {label}
        </label>
        {aside}
      </div>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid}
        aria-describedby={note ? noteId : undefined}
        className="h-10 w-full rounded-lg border border-input bg-transparent px-3 font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
      />
      {note ? (
        <div id={noteId} className="text-label text-pretty">
          {note}
        </div>
      ) : null}
    </div>
  );
}

export function AmountField({
  id,
  noteId,
  asset,
  value,
  onChange,
  most,
  invalid,
  note,
}: {
  readonly id: string;
  readonly noteId: string;
  readonly asset: Asset;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The most that can go, with whatever rides on top: what Max fills in. */
  readonly most: bigint;
  readonly invalid: boolean;
  readonly note: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-label font-medium text-muted-foreground">
          Amount
        </label>
        <span className="text-label text-muted-foreground">
          Up to {formatAmount(most, asset.decimals)} {asset.symbol}
        </span>
      </div>
      <div className="relative">
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          placeholder="0.0"
          autoComplete="off"
          aria-invalid={invalid}
          aria-describedby={noteId}
          className="h-10 w-full rounded-lg border border-input bg-transparent pr-14 pl-3 text-base tabular-nums outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
        />
        <span
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground"
          translate="no"
        >
          {asset.symbol}
        </span>
      </div>
      <div className="flex gap-1.5">
        {[
          { label: "25%", amount: most / 4n },
          { label: "50%", amount: most / 2n },
          { label: "Max", amount: most },
        ].map((fill) => (
          <button
            key={fill.label}
            type="button"
            disabled={fill.amount <= 0n}
            onClick={() => onChange(plainAmount(fill.amount, asset.decimals))}
            className={buttonVariants({ variant: "outline", size: "xs" })}
          >
            {fill.label}
          </button>
        ))}
      </div>
      <div id={noteId} className="text-label text-pretty">
        {note}
      </div>
    </div>
  );
}

/** A problem with a field: what is wrong, what helps, and a way on. */
export function ProblemLine({
  text,
  next,
  action,
}: {
  readonly text: string;
  readonly next?: string;
  readonly action?: ReactNode;
}) {
  return (
    <span role="alert" className="flex flex-col gap-1.5">
      <span className="text-destructive">{text}</span>
      {next ? <span className="text-muted-foreground">{next}</span> : null}
      {action}
    </span>
  );
}

export function Paused({ why }: { readonly why: "fee-wallet" | "treasury" | "off" }) {
  return (
    <Card>
      <div role="alert" className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Private actions are paused right now.</p>
        <p className="text-label text-pretty text-muted-foreground">
          {why === "treasury"
            ? "zSol's fee account isn't set up on this network yet, and every private payment pays its fee there. Your money isn't affected: it stays where it is."
            : "zSol's fee wallet can't pay network fees at the moment. Your money isn't affected: it stays where it is. Check again in a few minutes."}
        </p>
      </div>
    </Card>
  );
}

/** An action's own words for some failures, over the shared ones. */
export type FailureWords = Partial<
  Record<FailureFacts["kind"], { readonly title: string; readonly body: string }>
>;

export function PrepareFailure({
  facts,
  words: own,
}: {
  readonly facts: FailureFacts;
  readonly words?: FailureWords;
}) {
  const words = own?.[facts.kind] ?? FAILURE_WORDS[facts.kind];
  return (
    <Card>
      <div role="alert" className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-pretty">{words.title}</p>
        <p className="text-label text-pretty text-muted-foreground">{words.body}</p>
        {facts.retryAfter ? <Countdown seconds={facts.retryAfter} /> : null}
      </div>
      {facts.kind === "signed-out" ? (
        <button
          type="button"
          onClick={retrySignIn}
          className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
        >
          Sign in again
        </button>
      ) : null}
    </Card>
  );
}

export function ReviewButton({ preparing }: { readonly preparing: boolean }) {
  return (
    <button
      type="submit"
      disabled={preparing}
      className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
    >
      {preparing ? (
        <>
          <LoaderCircleIcon className="animate-spin" strokeWidth={1.75} />
          Preparing…
        </>
      ) : (
        "Review"
      )}
    </button>
  );
}

/** A review's buttons: confirm while it can still land, or prepare it again; and Back. */
export function ReviewActions({
  builtAt,
  confirmLabel,
  onConfirm,
  onRebuild,
  onBack,
}: {
  readonly builtAt: number;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onRebuild: () => void;
  readonly onBack: () => void;
}) {
  const now = useNow(5_000);
  const stale = now - builtAt > REVIEW_STALE_MS;
  return (
    <>
      {stale ? (
        <Card>
          <div role="alert" className="flex flex-col gap-2">
            <p className="text-sm text-pretty">
              This review is over a minute old, so it may not land any more. Prepare it again.
            </p>
            <button
              type="button"
              onClick={onRebuild}
              className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
            >
              Prepare it again
            </button>
          </div>
        </Card>
      ) : (
        <button
          type="button"
          onClick={onConfirm}
          className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
        >
          {confirmLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onBack}
        className={buttonVariants({ variant: "outline", size: "lg", className: "h-10 w-full" })}
      >
        Back
      </button>
    </>
  );
}

/** What the public will see, and what stays hidden. */
export function PublicAndHidden({
  seen,
  hidden,
}: {
  readonly seen: string;
  readonly hidden: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 border-t border-border/70 pt-3 text-label text-pretty">
      <div className="flex flex-col gap-1">
        <span className="font-medium">What the public will see</span>
        <span className="text-muted-foreground">{seen}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-medium">What stays hidden</span>
        <span className="text-muted-foreground">{hidden}</span>
      </div>
    </div>
  );
}

export function Sending({ order, site }: { readonly order: string; readonly site: string }) {
  const orders = useOrders();
  const found = orders.find((each) => each.id === order);
  return (
    <div className="flex flex-col gap-3">
      {found ? <OrderTracker order={found} site={site} /> : null}
      <p className="px-1 text-label text-pretty text-muted-foreground">
        Keep zSol open until it lands. If the panel closes, the order settles from the chain when
        you open it again, and it is never sent twice.
      </p>
    </div>
  );
}

/** A finished action: what is true now, its order, the public view, and the next steps. */
export function Done({
  title,
  body,
  order,
  signature,
  site,
  again,
  onAgain,
}: {
  readonly title: string;
  readonly body: ReactNode;
  readonly order: string;
  readonly signature: string;
  readonly site: string;
  readonly again?: string;
  readonly onAgain?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <output className="flex flex-col gap-1.5">
          <p className="text-base font-semibold text-pretty">{title}</p>
          <p className="text-sm text-pretty text-muted-foreground">{body}</p>
          <OrderId id={order} />
        </output>
        <ExternalLink href={`${site}/tx/${signature}`}>See what the public sees</ExternalLink>
      </Card>
      {again && onAgain ? (
        <button
          type="button"
          onClick={onAgain}
          className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
        >
          {again}
        </button>
      ) : null}
      <a
        href={placeHref("wallet")}
        className={buttonVariants({
          variant: again && onAgain ? "outline" : "default",
          size: "lg",
          className: "h-10 w-full",
        })}
      >
        Back to your wallet
      </a>
    </div>
  );
}

/** An action that stopped: what is true, its order, and the step that fits. */
export function Failed({
  facts,
  checking,
  checked,
  order,
  site,
  amount,
  decimals,
  onTryAgain,
  onCheckAgain,
  onChange,
  changeLabel,
  onDifferentReceiver,
  onSmaller,
  words: own,
}: {
  readonly facts: FailureFacts;
  readonly checking: boolean;
  readonly checked: Landed | null;
  readonly order: string;
  readonly site: string;
  readonly amount: bigint;
  readonly decimals: number;
  readonly onTryAgain: () => void;
  readonly onCheckAgain: () => void;
  readonly onChange: () => void;
  readonly changeLabel: string;
  /** Clears the receiver, for a sanctioned one. */
  readonly onDifferentReceiver?: () => void;
  /** Fills in a smaller amount. */
  readonly onSmaller?: (amountText: string) => void;
  readonly words?: FailureWords;
}) {
  const words = own?.[facts.kind] ?? FAILURE_WORDS[facts.kind];
  const half = amount / 2n;
  const primary = (() => {
    switch (facts.kind) {
      case "unconfirmed":
      case "unanswered":
        return {
          label: checking ? "Checking…" : "Check again",
          onClick: onCheckAgain,
          disabled: checking,
        };
      case "landed-unsynced":
        return { label: "Read my balance again", onClick: () => void readAgain() };
      case "signed-out":
        return { label: "Sign in again", onClick: retrySignIn };
      case "sanctioned":
        return onDifferentReceiver
          ? { label: "Pay a different address", onClick: onDifferentReceiver }
          : null;
      case "split":
      case "pieces":
        return onSmaller && half > 0n
          ? { label: "Try a smaller amount", onClick: () => onSmaller(plainAmount(half, decimals)) }
          : null;
      case "recipient":
        return null;
      default:
        return { label: "Try again", onClick: onTryAgain };
    }
  })();
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div role="alert" className="flex flex-col gap-1.5">
          <p className="text-base font-semibold text-pretty">{words.title}</p>
          <p className="text-sm text-pretty text-muted-foreground">{words.body}</p>
          <OrderId id={order} />
          {checked === "pending" ? (
            <p className="text-label text-pretty">
              Not landed yet. It can take up to a minute: check again shortly.
            </p>
          ) : null}
          {facts.retryAfter ? <Countdown seconds={facts.retryAfter} /> : null}
        </div>
        {facts.signature ? (
          <ExternalLink href={`${site}/tx/${facts.signature}`}>See it on the chain</ExternalLink>
        ) : null}
        {facts.kind === "recipient" ? (
          <ExternalLink href={`${site}/send#dark-link`}>Send a Dark link on zsol.cc</ExternalLink>
        ) : null}
      </Card>
      {primary ? (
        <RetryButton
          label={primary.label}
          onClick={primary.onClick}
          disabled={primary.disabled ?? false}
          waitSeconds={facts.retryAfter}
        />
      ) : null}
      {facts.maybeMoved ? (
        <a
          href={placeHref("wallet")}
          className={buttonVariants({ variant: "outline", size: "lg", className: "h-10 w-full" })}
        >
          Back to your wallet
        </a>
      ) : (
        <button
          type="button"
          onClick={onChange}
          className={buttonVariants({ variant: "outline", size: "lg", className: "h-10 w-full" })}
        >
          {changeLabel}
        </button>
      )}
    </div>
  );
}

function RetryButton({
  label,
  onClick,
  disabled,
  waitSeconds,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly waitSeconds: number | undefined;
}) {
  const left = useSecondsLeft(waitSeconds);
  return (
    <button
      type="button"
      disabled={disabled || left > 0}
      onClick={onClick}
      className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
    >
      {left > 0 ? `${label} in ${String(left)} s` : label}
    </button>
  );
}

export function Countdown({ seconds }: { readonly seconds: number }) {
  const left = useSecondsLeft(seconds);
  return left > 0 ? (
    <p className="text-label text-muted-foreground tabular-nums">
      Try again in {left} {left === 1 ? "second" : "seconds"}.
    </p>
  ) : null;
}

function useSecondsLeft(seconds: number | undefined): number {
  const [until] = useState(() => Date.now() + (seconds ?? 0) * 1000);
  const now = useNow(1_000);
  return Math.max(0, Math.ceil((until - now) / 1000));
}
