import {
  ArrowDownToLineIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { browser } from "wxt/browser";

import { placeHref } from "@/app/places";
import { buttonVariants } from "@/components/ui/button";
import { AccountCard } from "@/features/lock/account-card";
import { PasskeyOffer } from "@/features/lock/passkey-offer";
import { fundGhost } from "@/features/ghost/ghost-pay-store";
import { PublicMoneyCard } from "@/features/move/public-money-card";
import { MAX_GHOST_WALLETS } from "@/features/rings/keys";
import { formatAbout, formatShown } from "@/features/rings/amounts";
import { retrySignIn } from "@/features/session/session-store";
import { cn } from "@/lib/utils";

import { readAge } from "./age";
import { setAmountsHidden, useAmountsHidden } from "./use-hidden-amounts";
import { useNow } from "./use-now";
import {
  openWallet,
  readAgain,
  useWallet,
  type Balance,
  type Ghosts,
  type Hitch,
  type Refusal,
  type WalletView,
  ghostKeys,
} from "./wallet-store";

type Opened = Extract<WalletView, { kind: "opening" | "open" }>;

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/** A read older than this is renewed when the panel is shown again. */
const STALE_MS = 30_000;

const HITCH_WORDS: Record<Hitch, string> = {
  offline: "You're offline.",
  unreachable: "zSol didn't answer just now.",
  update: "This version of zSol for Chrome is too old for zSol now. Update it to go on.",
  failed: "Something went wrong reading it.",
};

const REFUSAL_WORDS: Record<Refusal, { readonly title: string; readonly body: string }> = {
  "signed-out": {
    title: "Your sign-in ended, so the wallet can't open.",
    body: "Nothing was sent or spent. Sign the panel in again.",
  },
  sanctioned: {
    title: "This wallet is on a sanctions list, so it can't use zSol.",
    body: "zSol checks every wallet against the US Treasury's sanctions list (OFAC) before it opens. Nothing was sent or spent.",
  },
  taken: {
    title: "This private wallet belongs to another zSol account.",
    body: "The wallet you connected already opens a private wallet for a different sign-in. Disconnect, then connect the panel from the account you used before.",
  },
  refused: {
    title: "zSol couldn't confirm this wallet.",
    body: "Nothing was sent or spent. Try again. If it keeps happening, disconnect and connect the panel again.",
  },
};

export function WalletPlace({
  seed,
  site,
  signInWallet,
  passkey,
}: {
  readonly seed: Uint8Array;
  readonly site: string;
  readonly signInWallet: string;
  /** A passkey on this device opens the wallet after a lock. */
  readonly passkey: boolean;
}) {
  const wallet = useWallet();
  return (
    <div className="flex flex-col gap-4 p-4">
      {wallet.kind === "refused" ? (
        <RefusalCard refusal={wallet.refusal} onRetry={() => void openWallet(seed, site)} />
      ) : wallet.kind === "closed" ? null : (
        <>
          <BalanceCard wallet={wallet} site={site} />
          {wallet.kind === "open" ? (
            <>
              <PublicMoneyCard signInWallet={signInWallet} />
              <GhostCard ghosts={wallet.ghosts} retry={wallet.hitch === null} />
              <PasskeyOffer on={passkey} />
            </>
          ) : null}
        </>
      )}
      <AccountCard signInWallet={signInWallet} passkey={passkey} />
    </div>
  );
}

/** Reads again when the browser is back online, and when the panel shows a stale read. */
export function useReadWhenBack(wallet: WalletView) {
  const hitch = wallet.kind === "opening" || wallet.kind === "open" ? wallet.hitch : null;
  const readAt = wallet.kind === "open" ? wallet.readAt : null;
  useEffect(() => {
    const online = () => {
      if (hitch !== null) void readAgain();
    };
    const shown = () => {
      if (document.visibilityState !== "visible") return;
      if (hitch !== null || (readAt !== null && Date.now() - readAt > STALE_MS)) {
        void readAgain();
      }
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", shown);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [hitch, readAt]);
}

function Card({
  title,
  aside,
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  const id = `card-${title.toLowerCase().replaceAll(/\W+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-4"
    >
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2 id={id} className="text-label font-medium text-muted-foreground">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function BalanceCard({ wallet, site }: { readonly wallet: Opened; readonly site: string }) {
  const hidden = useAmountsHidden();
  const now = useNow();
  const { balances, reading, hitch } = wallet;
  const empty = balances !== null && balances.every((balance) => balance.amount === 0n);
  return (
    <Card
      title="Private balance"
      aside={
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            aria-label={hidden ? "Show amounts" : "Hide amounts"}
            title={hidden ? "Show amounts" : "Hide amounts"}
            aria-pressed={hidden}
            onClick={() => setAmountsHidden(!hidden)}
          >
            {hidden ? <EyeOffIcon strokeWidth={1.75} /> : <EyeIcon strokeWidth={1.75} />}
          </button>
          <button
            type="button"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            aria-label={reading ? "Reading your balance…" : "Read your balance again"}
            title={reading ? "Reading your balance…" : "Read your balance again"}
            disabled={reading}
            onClick={() => void readAgain()}
          >
            <RefreshCwIcon className={cn(reading && "animate-spin")} strokeWidth={1.75} />
          </button>
        </span>
      }
    >
      {balances === null ? (
        hitch === null ? (
          <Figures balances={null} hidden={hidden} />
        ) : (
          <Hitched hitch={hitch} />
        )
      ) : (
        <Figures balances={balances} hidden={hidden} />
      )}
      <output aria-live="polite" className="text-label text-pretty text-muted-foreground">
        {readLine(wallet, now)}
      </output>
      {hitch !== null && balances !== null ? <TryAgain hitch={hitch} disabled={reading} /> : null}
      {wallet.kind === "open" && !empty ? (
        <nav aria-label="Move money" className="grid grid-cols-2 gap-2">
          <a
            href={placeHref("send")}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowUpRightIcon data-icon="inline-start" strokeWidth={1.75} />
            Send dark
          </a>
          <a
            href={placeHref("unshield")}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowDownToLineIcon data-icon="inline-start" strokeWidth={1.75} />
            Unshield
          </a>
          <a
            href={placeHref("claim")}
            className={buttonVariants({ variant: "ghost", size: "sm", className: "col-span-2" })}
          >
            Claim a Dark link someone sent you
          </a>
          <a
            href={`${site}/wallet#go-dark`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "ghost", size: "sm", className: "col-span-2" })}
          >
            Add money: Go dark on zsol.cc
            <ExternalLinkIcon data-icon="inline-end" strokeWidth={1.75} />
          </a>
        </nav>
      ) : null}
      {empty && wallet.kind === "open" && hitch === null ? (
        <div className="flex flex-col gap-2 border-t border-border/70 pt-3">
          <p className="text-sm font-medium">Nothing here yet.</p>
          <p className="text-label text-pretty text-muted-foreground">
            Go dark on zsol.cc to move SOL or tokens in from your wallet. Your wallet approves it
            there.
          </p>
          <ExternalLink href={`${site}/wallet#go-dark`}>Go dark on zsol.cc</ExternalLink>
          <a
            href={placeHref("claim")}
            className={buttonVariants({
              variant: "ghost",
              size: "sm",
              className: "-ml-2 self-start",
            })}
          >
            Claim a Dark link someone sent you
          </a>
        </div>
      ) : null}
      {wallet.address === null ? null : (
        <AddressLine address={wallet.address} registered={wallet.registered} />
      )}
    </Card>
  );
}

function readLine(wallet: Opened, now: number): string {
  if (wallet.balances === null) {
    return wallet.hitch === null ? "Opening your private wallet…" : "";
  }
  const age = wallet.readAt === null ? null : readAge(wallet.readAt, now);
  if (wallet.hitch !== null) {
    return age === null
      ? `${HITCH_WORDS[wallet.hitch]} This is the balance last kept in this browser.`
      : `${HITCH_WORDS[wallet.hitch]} This is your balance as of ${age}.`;
  }
  if (wallet.reading) {
    return age === null ? "Reading your balance…" : `Read ${age}. Reading again…`;
  }
  return age === null ? "" : `Read ${age}.`;
}

function Figures({
  balances,
  hidden,
}: {
  readonly balances: readonly Balance[] | null;
  readonly hidden: boolean;
}) {
  const rows = (balances ?? []).slice(0, 2);
  const others = (balances ?? []).slice(2).filter((balance) => balance.amount > 0n);
  return (
    <>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-3" aria-busy={balances === null}>
        {balances === null
          ? ["SOL", "USDC"].map((symbol) => (
              <li key={symbol} className="flex min-w-0 flex-col gap-1">
                <span className="text-label text-muted-foreground" translate="no">
                  {symbol}
                </span>
                <span className="h-9 w-24 animate-pulse rounded-md bg-muted" />
              </li>
            ))
          : rows.map((balance) => (
              <li key={balance.asset.mint} className="flex min-w-0 flex-col gap-1">
                <span className="text-label text-muted-foreground" translate="no">
                  {balance.asset.symbol}
                </span>
                <Amount balance={balance} hidden={hidden} />
              </li>
            ))}
      </ul>
      {others.length > 0 ? (
        <ul
          aria-label="Other tokens"
          className="flex flex-col gap-1.5 border-t border-border/70 pt-3"
        >
          {others.map((balance) => (
            <li key={balance.asset.mint} className="flex items-baseline justify-between gap-3">
              <span
                className="truncate text-sm text-muted-foreground"
                title={balance.asset.mint}
                translate="no"
              >
                {balance.asset.symbol}
              </span>
              <span className="shrink-0 text-sm font-medium tabular-nums">
                {hidden
                  ? "Hidden"
                  : formatShown(balance.amount, balance.asset.decimals, balance.asset.places)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Amount({ balance, hidden }: { readonly balance: Balance; readonly hidden: boolean }) {
  if (hidden) {
    return (
      <span className="h-9 w-24 rounded-md bg-frost">
        <span className="sr-only">Hidden amount</span>
      </span>
    );
  }
  return (
    <span className="truncate font-display text-[1.75rem] leading-9 font-semibold tracking-tight">
      {formatShown(balance.amount, balance.asset.decimals, balance.asset.places)}
    </span>
  );
}

function Hitched({ hitch }: { readonly hitch: Hitch }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-pretty">
        {HITCH_WORDS[hitch]} Your private wallet opens once zSol answers.
      </p>
      <TryAgain hitch={hitch} disabled={false} />
    </div>
  );
}

function TryAgain({ hitch, disabled }: { readonly hitch: Hitch; readonly disabled: boolean }) {
  if (hitch === "update") {
    return (
      <ExternalLink href={`https://chromewebstore.google.com/detail/${browser.runtime.id}`}>
        Update zSol for Chrome
      </ExternalLink>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void readAgain()}
      className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
    >
      Try again
    </button>
  );
}

function AddressLine({
  address,
  registered,
}: {
  readonly address: string;
  readonly registered: boolean | null;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-border/70 pt-3">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-label text-muted-foreground">Your zSol address</span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-label"
          title={address}
          translate="no"
        >
          {short(address)}
        </span>
        <CopyButton value={address} label="Copy your zSol address" />
      </div>
      {registered === false ? (
        <p className="text-label text-pretty text-warn">
          Others can pay this address once it's listed: your first Go dark on zsol.cc lists it, and
          so does moving money in from here.
        </p>
      ) : registered ? (
        <p className="text-label text-pretty text-muted-foreground">
          Sent from outside zSol, money lands here in public until you move it in.
        </p>
      ) : null}
    </div>
  );
}

function CopyButton({ value, label }: { readonly value: string; readonly label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
    >
      {copied ? <CheckIcon strokeWidth={1.75} /> : <CopyIcon strokeWidth={1.75} />}
    </button>
  );
}

/** Funds the ghost wallet numbered `index`, made from the seed when it is asked for. */
function NewGhostButton({ index, label }: { readonly index: number; readonly label: string }) {
  const [making, setMaking] = useState(false);
  return (
    <button
      type="button"
      disabled={making}
      onClick={() => {
        const made = ghostKeys(index);
        if (!made) return;
        setMaking(true);
        void made.then((ghost) => fundGhost(index, ghost.address)).finally(() => setMaking(false));
      }}
      className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
    >
      {label}
    </button>
  );
}

function GhostCard({
  ghosts,
  retry,
}: {
  readonly ghosts: Ghosts | null;
  /** Its own Try again, unless the balance above already offers one. */
  readonly retry: boolean;
}) {
  const hidden = useAmountsHidden();
  const rows = ghosts?.rows ?? [];
  const reading = ghosts === null || ghosts.reading;
  return (
    <Card title="Ghost wallets">
      {rows.length === 0 && reading ? (
        <p className="text-label text-muted-foreground">Looking for your ghost wallets…</p>
      ) : null}
      {rows.length === 0 && !reading && ghosts.hitch === null ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">No ghost wallets yet.</p>
          <p className="text-label text-pretty text-muted-foreground">
            A ghost wallet trades in public with nothing on chain tying it to you. Fund your first
            one through Ghost Route.
          </p>
          <NewGhostButton index={0} label="Fund your first ghost wallet" />
        </div>
      ) : null}
      {rows.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border/70">
          {rows.map((row) => (
            <li key={row.address} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">Ghost {row.index + 1}</span>
                <span
                  className="truncate font-mono text-label text-muted-foreground"
                  title={row.address}
                  translate="no"
                >
                  {short(row.address)}
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium tabular-nums">
                {row.sol === null
                  ? "Unread"
                  : hidden
                    ? "Hidden"
                    : `${formatAbout(row.sol, 9, 4)} SOL`}
              </span>
              <button
                type="button"
                onClick={() => fundGhost(row.index, row.address)}
                className={buttonVariants({ variant: "outline", size: "xs" })}
                aria-label={`Fund Ghost ${row.index + 1} through Ghost Route`}
              >
                Fund
              </button>
              <CopyButton value={row.address} label={`Copy Ghost ${row.index + 1}'s address`} />
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length > 0 && !reading && rows.length < MAX_GHOST_WALLETS ? (
        <NewGhostButton index={rows.length} label="Fund a new ghost wallet" />
      ) : null}
      {rows.length > 0 && ghosts?.reading ? (
        <p className="text-label text-muted-foreground">Looking for more…</p>
      ) : null}
      {ghosts?.hitch ? (
        <div className="flex flex-col gap-2">
          <p className="text-label text-pretty text-muted-foreground">
            {HITCH_WORDS[ghosts.hitch]}{" "}
            {rows.length > 0
              ? "Some ghost wallets may be missing."
              : "Your ghost wallets weren't read."}
          </p>
          {retry ? <TryAgain hitch={ghosts.hitch} disabled={ghosts.reading} /> : null}
        </div>
      ) : null}
    </Card>
  );
}

function RefusalCard({
  refusal,
  onRetry,
}: {
  readonly refusal: Refusal;
  readonly onRetry: () => void;
}) {
  const words = REFUSAL_WORDS[refusal];
  return (
    <section
      role="alert"
      className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-4"
    >
      <h2 className="text-base font-semibold text-pretty">{words.title}</h2>
      <p className="text-sm text-pretty text-muted-foreground">{words.body}</p>
      {refusal === "signed-out" ? (
        <button
          type="button"
          onClick={retrySignIn}
          className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
        >
          Sign in again
        </button>
      ) : refusal === "refused" ? (
        <button
          type="button"
          onClick={onRetry}
          className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
        >
          Try again
        </button>
      ) : null}
    </section>
  );
}

function ExternalLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
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
