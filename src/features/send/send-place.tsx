import { ArrowRightIcon, CheckIcon, ExternalLinkIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import { placeHref } from "@/app/places";
import { buttonVariants } from "@/components/ui/button";
import { formatAmount, formatShown } from "@/features/rings/amounts";
import { mostWithFee, percentOf, plainAmount, readAmount } from "@/features/rings/amount-input";
import { WALLET_ASSETS, type Asset } from "@/features/rings/holdings";
import { retrySignIn } from "@/features/session/session-store";
import { useNow } from "@/features/wallet/use-now";
import { readAgain, useWallet } from "@/features/wallet/wallet-store";
import { cn } from "@/lib/utils";

import type { FailureFacts } from "./outcomes";
import {
  another,
  back,
  checkAgain,
  confirm,
  edit,
  feeOn,
  review,
  setDraft,
  useDraft,
  useFeeTerms,
  useSend,
  warmFees,
  type FormProblem,
  type Review,
  type SendState,
} from "./send-store";
import type { SendStep } from "./sponsor";
import { AMOUNT_WORDS, FAILURE_WORDS, feeWords, STEP_WORDS, STEPS } from "./words";

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
/** A review older than this may carry a blockhash that no longer lands: prepare it again. */
const REVIEW_STALE_MS = 50_000;

export function SendPlace({
  site,
  signInWallet,
}: {
  readonly site: string;
  readonly signInWallet: string;
}) {
  const wallet = useWallet();
  const send = useSend();
  useEffect(() => {
    void warmFees(site);
  }, [site]);
  if (wallet.kind !== "open" || wallet.balances === null) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Heading />
        <section className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-4">
          <p className="text-sm text-pretty text-muted-foreground">
            {wallet.kind === "refused"
              ? "Send opens once your private wallet opens. Your wallet tab says why it couldn't."
              : "Send opens once your private wallet is open."}
          </p>
          <a
            href={placeHref("wallet")}
            className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
          >
            Go to your wallet
          </a>
        </section>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 p-4">
      <Heading />
      <Stage send={send} site={site} signInWallet={signInWallet} />
    </div>
  );
}

function Heading() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="headline text-2xl">Send dark</h1>
      <p className="text-sm text-pretty text-muted-foreground">
        Pay a zSol address. The amount and the token stay hidden.
      </p>
    </div>
  );
}

function Stage({
  send,
  site,
  signInWallet,
}: {
  readonly send: SendState;
  readonly site: string;
  readonly signInWallet: string;
}) {
  if (send.kind === "form") {
    return <SendForm send={send} site={site} signInWallet={signInWallet} />;
  }
  if (send.kind === "review")
    return <ReviewCard review={send.review} signInWallet={signInWallet} />;
  if (send.kind === "sending") return <Sending review={send.review} step={send.step} />;
  if (send.kind === "done") {
    return <Done review={send.review} signature={send.signature} site={site} />;
  }
  return <Failed send={send} site={site} signInWallet={signInWallet} />;
}

function Card({
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

function SendForm({
  send,
  site,
  signInWallet,
}: {
  readonly send: Extract<SendState, { kind: "form" }>;
  readonly site: string;
  readonly signInWallet: string;
}) {
  const draft = useDraft();
  const wallet = useWallet();
  const terms = useFeeTerms();
  const rate = percentOf(terms.sendFeeBps);
  const ids = { to: useId(), amount: useId(), toNote: useId(), amountNote: useId() };
  const asset = WALLET_ASSETS.find((each) => each.mint === draft.mint) ?? WALLET_ASSETS[0]!;
  const held =
    wallet.kind === "open"
      ? (wallet.balances?.find((balance) => balance.asset.mint === asset.mint)?.amount ?? 0n)
      : 0n;
  const charged = terms.feeAssets.has(asset.mint);
  const least = charged ? (terms.sendFeeMinimums.get(asset.mint) ?? 0n) : 0n;
  const most = mostWithFee(held, (amount) => feeOn(asset.mint, amount, terms));
  const typed = readAmount(draft.amountText, asset.decimals);
  const fee = typed.ok ? feeOn(asset.mint, typed.amount, terms) : null;
  const problem = send.problem;
  const toProblem =
    problem && ["to-empty", "bad-address", "own", "sign-in", "no-wallet"].includes(problem.kind)
      ? problem
      : null;
  const amountProblem =
    problem && (problem.kind === "amount" || problem.kind === "short") ? problem : null;
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void review(signInWallet);
      }}
    >
      <Card>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.to} className="text-label font-medium text-muted-foreground">
            To
          </label>
          <input
            id={ids.to}
            value={draft.to}
            onChange={(event) => setDraft({ to: event.target.value })}
            placeholder="Their zSol address"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={toProblem !== null}
            aria-describedby={toProblem ? ids.toNote : undefined}
            className="h-10 w-full rounded-lg border border-input bg-transparent px-3 font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
          />
          {toProblem ? <ToProblem id={ids.toNote} problem={toProblem} site={site} /> : null}
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-label font-medium text-muted-foreground">Token</legend>
          <div className="grid grid-cols-2 gap-2">
            {WALLET_ASSETS.map((each) => (
              <TokenChoice
                key={each.mint}
                asset={each}
                picked={each.mint === asset.mint}
                held={
                  wallet.kind === "open"
                    ? (wallet.balances?.find((balance) => balance.asset.mint === each.mint)
                        ?.amount ?? 0n)
                    : 0n
                }
              />
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={ids.amount} className="text-label font-medium text-muted-foreground">
              Amount
            </label>
            <span className="text-label text-muted-foreground">
              Up to {formatAmount(most, asset.decimals)} {asset.symbol}
            </span>
          </div>
          <div className="relative">
            <input
              id={ids.amount}
              value={draft.amountText}
              onChange={(event) => setDraft({ amountText: event.target.value })}
              inputMode="decimal"
              placeholder="0.0"
              autoComplete="off"
              aria-invalid={amountProblem !== null}
              aria-describedby={ids.amountNote}
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
                onClick={() => setDraft({ amountText: plainAmount(fill.amount, asset.decimals) })}
                className={buttonVariants({ variant: "outline", size: "xs" })}
              >
                {fill.label}
              </button>
            ))}
          </div>
          <div id={ids.amountNote} className="text-label text-pretty">
            {amountProblem ? (
              <AmountProblemLine problem={amountProblem} asset={asset} rate={rate} least={least} />
            ) : (
              <span className="text-muted-foreground">
                {feeWords({
                  rate,
                  least: least > 0n ? formatAmount(least, asset.decimals) : null,
                  fee: fee !== null && fee > 0n ? formatAmount(fee, asset.decimals) : null,
                  symbol: asset.symbol,
                  charged,
                })}
              </span>
            )}
          </div>
        </div>
      </Card>
      {problem?.kind === "paused" ? <Paused why={problem.why} /> : null}
      {send.failure ? <PrepareFailure facts={send.failure} /> : null}
      <button
        type="submit"
        disabled={send.preparing}
        className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
      >
        {send.preparing ? (
          <>
            <LoaderCircleIcon className="animate-spin" strokeWidth={1.75} />
            Preparing…
          </>
        ) : (
          "Review"
        )}
      </button>
      <p className="px-1 text-label text-pretty text-muted-foreground">
        Paid from your private balance, to zSol addresses only.
      </p>
    </form>
  );
}

function TokenChoice({
  asset,
  picked,
  held,
}: {
  readonly asset: Asset;
  readonly picked: boolean;
  readonly held: bigint;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        picked ? "border-primary bg-frost" : "border-border hover:bg-muted/50",
      )}
    >
      <input
        type="radio"
        name="token"
        value={asset.mint}
        checked={picked}
        onChange={() => setDraft({ mint: asset.mint, amountText: "" })}
        className="sr-only"
      />
      <span className="text-sm font-medium" translate="no">
        {asset.symbol}
      </span>
      <span className="text-label text-muted-foreground tabular-nums">
        {formatShown(held, asset.decimals, asset.places)} held
      </span>
    </label>
  );
}

function ToProblem({
  id,
  problem,
  site,
}: {
  readonly id: string;
  readonly problem: FormProblem;
  readonly site: string;
}) {
  const line = (text: string, next?: string, link?: { href: string; label: string }) => (
    <div id={id} role="alert" className="flex flex-col gap-1.5 text-label text-pretty">
      <span className="text-destructive">{text}</span>
      {next ? <span className="text-muted-foreground">{next}</span> : null}
      {link ? <ExternalLink href={link.href}>{link.label}</ExternalLink> : null}
    </div>
  );
  switch (problem.kind) {
    case "to-empty":
      return line("Add the zSol address you're paying.");
    case "bad-address":
      return line(
        "That isn't a Solana address.",
        "A Solana address is 32 to 44 letters and digits. Check it was copied in full.",
      );
    case "own":
      return line(
        "That's your own zSol address.",
        "To move money to a regular wallet, Unshield it instead.",
        { href: `${site}/wallet#unshield`, label: "Unshield on zsol.cc" },
      );
    case "sign-in":
      return line(
        "That's the wallet you sign in with.",
        "Send dark pays zSol private wallets. To move money to the wallet you sign in with, Unshield it: it arrives there in public.",
        { href: `${site}/wallet#unshield`, label: "Unshield on zsol.cc" },
      );
    case "no-wallet":
      return line(
        "This address has no private wallet yet, so it can't be paid privately.",
        "A Dark link reaches anyone: they claim it into a private wallet of their own.",
        { href: `${site}/send#dark-link`, label: "Send a Dark link on zsol.cc" },
      );
    default:
      return null;
  }
}

function AmountProblemLine({
  problem,
  asset,
  rate,
  least,
}: {
  readonly problem: Extract<FormProblem, { kind: "amount" | "short" }>;
  readonly asset: Asset;
  /** zSol's fee rate as people read it: "0.1%". */
  readonly rate: string;
  /** zSol's least fee on this token, zero when it states none. */
  readonly least: bigint;
}) {
  if (problem.kind === "amount") {
    return (
      <span role="alert" className="text-destructive">
        {AMOUNT_WORDS[problem.problem](asset.symbol, asset.decimals)}
      </span>
    );
  }
  const { short: lack } = problem;
  const show = (value: bigint) => formatAmount(value, asset.decimals);
  return (
    <span role="alert" className="flex flex-col gap-1.5">
      <span className="text-destructive">
        {lack.held === 0n
          ? `Your private balance holds no ${asset.symbol}.`
          : `Your private balance is ${show(lack.short)} ${asset.symbol} short.`}
      </span>
      <span className="text-muted-foreground">
        {lack.fee > 0n
          ? `It holds ${show(lack.held)} ${asset.symbol}. This needs ${show(lack.needed)} ${asset.symbol}: ${show(lack.amount)} plus zSol's ${least > 0n && lack.fee === least ? "least" : rate} fee of ${show(lack.fee)}.`
          : `It holds ${show(lack.held)} ${asset.symbol}. This needs ${show(lack.needed)} ${asset.symbol}.`}
      </span>
      {lack.most > 0n ? (
        <button
          type="button"
          onClick={() => setDraft({ amountText: plainAmount(lack.most, asset.decimals) })}
          className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
        >
          Send the most you can: {show(lack.most)} {asset.symbol}
        </button>
      ) : null}
    </span>
  );
}

function Paused({ why }: { readonly why: "fee-wallet" | "treasury" | "off" }) {
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

function PrepareFailure({ facts }: { readonly facts: FailureFacts }) {
  const words = FAILURE_WORDS[facts.kind];
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

function ReviewCard({
  review: sent,
  signInWallet,
}: {
  readonly review: Review;
  readonly signInWallet: string;
}) {
  const now = useNow(5_000);
  const stale = now - sent.builtAt > REVIEW_STALE_MS;
  const show = (value: bigint) =>
    `${formatAmount(value, sent.asset.decimals)} ${sent.asset.symbol}`;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-center gap-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-label text-muted-foreground">You</span>
            <span className="font-display text-xl font-semibold tabular-nums">
              {show(sent.amount)}
            </span>
          </span>
          <ArrowRightIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
          <span className="flex min-w-0 flex-1 flex-col items-end">
            <span className="text-label text-muted-foreground">Them</span>
            <span className="font-mono text-sm" title={sent.to} translate="no">
              {short(sent.to)}
            </span>
          </span>
        </div>
        <p className="text-label text-pretty text-muted-foreground">
          {feeWords({
            rate: percentOf(sent.feeBps),
            least: sent.feeLeast > 0n ? formatAmount(sent.feeLeast, sent.asset.decimals) : null,
            fee: formatAmount(sent.fee, sent.asset.decimals),
            symbol: sent.asset.symbol,
            charged: sent.fee > 0n,
          })}
        </p>
        <div className="grid grid-cols-2 gap-3 border-t border-border/70 pt-3 text-label text-pretty">
          <div className="flex flex-col gap-1">
            <span className="font-medium">What the public will see</span>
            <span className="text-muted-foreground">
              Your zSol address paid theirs, and when. zSol's fee is one more payment in the same
              transaction.
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-medium">What stays hidden</span>
            <span className="text-muted-foreground">The amount and the token.</span>
          </div>
        </div>
      </Card>
      {stale ? (
        <Card>
          <div role="alert" className="flex flex-col gap-2">
            <p className="text-sm text-pretty">
              This review is over a minute old, so it may not land any more. Prepare it again.
            </p>
            <button
              type="button"
              onClick={() => {
                edit();
                void review(signInWallet);
              }}
              className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
            >
              Prepare it again
            </button>
          </div>
        </Card>
      ) : (
        <button
          type="button"
          onClick={() => void confirm()}
          className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
        >
          Send dark
        </button>
      )}
      <button
        type="button"
        onClick={back}
        className={buttonVariants({ variant: "outline", size: "lg", className: "h-10 w-full" })}
      >
        Back
      </button>
    </div>
  );
}

function Sending({ review: sent, step }: { readonly review: Review; readonly step: SendStep }) {
  const at = STEPS.indexOf(step);
  return (
    <Card>
      <p className="text-sm text-pretty">
        Sending {formatAmount(sent.amount, sent.asset.decimals)} {sent.asset.symbol} to{" "}
        <span className="font-mono" translate="no">
          {short(sent.to)}
        </span>
        . Keep this panel open until it lands.
      </p>
      <ol aria-label="Progress" className="flex flex-col gap-2.5">
        {STEPS.map((each, index) => (
          <li
            key={each}
            aria-current={index === at ? "step" : undefined}
            className={cn(
              "flex items-center gap-2.5 text-sm",
              index > at ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {index < at ? (
              <CheckIcon className="size-4 text-ok" strokeWidth={2} />
            ) : index === at ? (
              <LoaderCircleIcon className="size-4 animate-spin text-primary" strokeWidth={2} />
            ) : (
              <span aria-hidden="true" className="mx-1.5 size-1 rounded-full bg-muted-foreground" />
            )}
            {STEP_WORDS[each]}
          </li>
        ))}
      </ol>
      <output aria-live="polite" className="sr-only">
        {STEP_WORDS[step]}
      </output>
    </Card>
  );
}

function Done({
  review: sent,
  signature,
  site,
}: {
  readonly review: Review;
  readonly signature: string;
  readonly site: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <output className="flex flex-col gap-1.5">
          <p className="flex items-center gap-2 text-base font-semibold">
            <CheckIcon className="size-4 text-ok" strokeWidth={2.25} />
            Sent. It's in their private balance.
          </p>
          <p className="text-sm text-pretty text-muted-foreground">
            {formatAmount(sent.amount, sent.asset.decimals)} {sent.asset.symbol} to{" "}
            <span className="font-mono" title={sent.to} translate="no">
              {short(sent.to)}
            </span>
            . Your balance is up to date.
          </p>
        </output>
        <ExternalLink href={`${site}/tx/${signature}`}>See what the public sees</ExternalLink>
      </Card>
      <button
        type="button"
        onClick={another}
        className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
      >
        Send another
      </button>
      <a
        href={placeHref("wallet")}
        className={buttonVariants({ variant: "outline", size: "lg", className: "h-10 w-full" })}
      >
        Back to your wallet
      </a>
    </div>
  );
}

function Failed({
  send,
  site,
  signInWallet,
}: {
  readonly send: Extract<SendState, { kind: "failed" }>;
  readonly site: string;
  readonly signInWallet: string;
}) {
  const { facts, checking, checked } = send;
  const words = FAILURE_WORDS[facts.kind];
  const tryAgain = () => {
    edit();
    void review(signInWallet);
  };
  const smaller = () => {
    const half = send.review.amount / 2n;
    edit();
    if (half > 0n) setDraft({ amountText: plainAmount(half, send.review.asset.decimals) });
  };
  const primary = (() => {
    switch (facts.kind) {
      case "unconfirmed":
      case "unanswered":
        return {
          label: checking ? "Checking…" : "Check again",
          onClick: () => void checkAgain(),
          disabled: checking,
        };
      case "landed-unsynced":
        return { label: "Read my balance again", onClick: () => void readAgain() };
      case "signed-out":
        return { label: "Sign in again", onClick: retrySignIn };
      case "sanctioned":
        return {
          label: "Pay a different address",
          onClick: () => {
            edit();
            setDraft({ to: "" });
          },
        };
      case "split":
      case "pieces":
        return { label: "Try a smaller amount", onClick: smaller };
      case "recipient":
        return null;
      default:
        return { label: "Try again", onClick: tryAgain };
    }
  })();
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div role="alert" className="flex flex-col gap-1.5">
          <p className="text-base font-semibold text-pretty">{words.title}</p>
          <p className="text-sm text-pretty text-muted-foreground">{words.body}</p>
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
          onClick={edit}
          className={buttonVariants({ variant: "outline", size: "lg", className: "h-10 w-full" })}
        >
          Change the send
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

function Countdown({ seconds }: { readonly seconds: number }) {
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
