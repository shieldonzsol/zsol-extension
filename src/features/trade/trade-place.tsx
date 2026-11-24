import { ArrowDownIcon, ArrowRightIcon, LoaderCircleIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  AmountField,
  Card,
  Done,
  Failed,
  Heading,
  NotOpenYet,
  Paused,
  PrepareFailure,
  ProblemLine,
  PublicAndHidden,
  ReviewActions,
  Sending,
  short,
  useHeld,
  type FailureWords,
} from "@/features/action/parts";
import { useFeeTerms, warmTerms } from "@/features/action/terms";
import { AMOUNT_WORDS } from "@/features/action/words";
import { plainAmount, readAmount } from "@/features/rings/amount-input";
import { formatAbout, formatAmount } from "@/features/rings/amounts";
import { WALLET_ASSETS } from "@/features/rings/holdings";
import { ghostTradeFee, tradeFee } from "@/features/rings/trade-fees";
import type { PublicMoney } from "@/features/rings/sweep";
import { useWallet, type GhostRow } from "@/features/wallet/wallet-store";
import { cn } from "@/lib/utils";

import { isSol, PRIVATE_SOL, type TradeRefusal } from "./trade-api";
import {
  useGhostMoney,
  useLiveQuote,
  usePageToken,
  useTokenSearch,
  type LiveQuote,
} from "./trade-hooks";
import {
  another,
  back,
  checkAgain,
  confirm,
  edit,
  feeSideOf,
  ghostMaxBuy,
  mostSolIn,
  review,
  setDraft,
  SLIPPAGES,
  SOL_PICK,
  useTrade,
  useTradeDraft,
  type FormProblem,
  type Review,
  type TradeDraft,
  type TradePick,
  type TradeSource,
  type TradeState,
} from "./trade-store";

const sol = (lamports: bigint) => `${formatAmount(lamports, 9)} SOL`;
const percent = (bps: number) => `${String(bps / 100)}%`;

const ROUTE_WORDS: Record<TradeRefusal | "offline", string> = {
  "no-route": "Jupiter found no route for this pair right now.",
  busy: "Too many quotes at once. Wait a moment, then try again.",
  unreachable: "zSol couldn't be reached for a quote.",
  "bad-token": "Jupiter can't trade one of these tokens.",
  "amount-too-small": "This amount is too small for anything to come back.",
  "amount-too-large": "This amount is more than the token can hold.",
  "no-value":
    "Neither side is SOL and Jupiter has no SOL price for it, so zSol's fee can't be set.",
  "signed-out": "Your sign-in ended. Sign the panel in again to trade.",
  "same-token": "Pick two different tokens.",
  failed: "zSol's answer couldn't be read.",
  offline: "You're offline.",
};

const TRADE_FAILURE_WORDS: FailureWords = {
  "failed-on-chain": {
    title: "It reached Solana and failed there. Nothing moved.",
    body: "The price may have moved past your slippage. Your balance is as it was. Try again.",
  },
  failed: {
    title: "It didn't go through. Nothing moved.",
    body: "Solana refused it before it went out, often because the price moved. Try again.",
  },
  stale: {
    title: "zSol's fee changed while it was being prepared. Nothing moved.",
    body: "Prepare it again with the figures as they are now.",
  },
};

export function TradePlace({
  site,
  signInWallet,
}: {
  readonly site: string;
  readonly signInWallet: string;
}) {
  const wallet = useWallet();
  const state = useTrade();
  useEffect(() => {
    void warmTerms(site);
  }, [site]);
  return (
    <div className="flex flex-col gap-4 p-4">
      <Heading
        title="Trade"
        body="Any token Jupiter routes, from your private balance or from a ghost wallet."
      />
      {wallet.kind !== "open" || wallet.balances === null ? (
        <NotOpenYet what="Trade" />
      ) : (
        <Stage state={state} site={site} signInWallet={signInWallet} />
      )}
    </div>
  );
}

function Stage({
  state,
  site,
  signInWallet,
}: {
  readonly state: TradeState;
  readonly site: string;
  readonly signInWallet: string;
}) {
  if (state.kind === "form")
    return <TradeForm state={state} site={site} signInWallet={signInWallet} />;
  if (state.kind === "review") {
    return <ReviewCard review={state.review} signInWallet={signInWallet} />;
  }
  if (state.kind === "sending") return <Sending order={state.order} site={site} />;
  if (state.kind === "done") {
    const done = state.review;
    return (
      <Done
        title={
          done.source.kind === "ghost"
            ? `Swapped. It's in Ghost ${String(done.source.index + 1)}.`
            : "Traded. It's in your private balance."
        }
        body={`${formatAmount(done.amount, done.from.decimals)} ${done.from.symbol} for at least ${formatAmount(done.minOut, done.to.decimals)} ${done.to.symbol}. Your balances are read again.`}
        order={state.order}
        signature={state.signature}
        site={site}
        again="Trade again"
        onAgain={another}
      />
    );
  }
  return (
    <Failed
      facts={state.facts}
      checking={state.checking}
      checked={state.checked}
      order={state.order}
      site={site}
      amount={state.review.amount}
      decimals={state.review.from.decimals}
      onTryAgain={() => {
        edit();
        void review(signInWallet);
      }}
      onCheckAgain={() => void checkAgain()}
      onChange={edit}
      changeLabel="Change the trade"
      words={TRADE_FAILURE_WORDS}
    />
  );
}

function TradeForm({
  state,
  site,
  signInWallet,
}: {
  readonly state: Extract<TradeState, { kind: "form" }>;
  readonly site: string;
  readonly signInWallet: string;
}) {
  const draft = useTradeDraft();
  const wallet = useWallet();
  const held = useHeld();
  const terms = useFeeTerms();
  const ghostAddress = draft.source.kind === "ghost" ? draft.source.address : null;
  const ghostMoney = useGhostMoney(ghostAddress);
  const quote = useLiveQuote(site, draft);
  const pageToken = usePageToken(site);
  const ids = { amount: useId(), amountNote: useId() };
  const ghosts = wallet.kind === "open" ? (wallet.ghosts?.rows ?? []) : [];
  const heldOf = (mint: string): bigint | null => {
    if (draft.source.kind === "private") return held(mint);
    if (!ghostMoney) return null;
    return isSol(mint)
      ? ghostMoney.lamports
      : (ghostMoney.tokens.find((token) => token.mint === mint)?.amount ?? 0n);
  };
  const fromHeld = heldOf(draft.from.mint);
  const most =
    fromHeld === null
      ? 0n
      : isSol(draft.from.mint)
        ? draft.source.kind === "ghost"
          ? ghostMaxBuy(fromHeld)
          : mostSolIn(fromHeld, NEW_ACCOUNT_ROOM, terms.tradeFeeMinimum)
        : fromHeld;
  const { problem } = state;
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void review(signInWallet);
      }}
    >
      {pageToken && pageToken.mint !== draft.to?.mint ? (
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-card px-4 py-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-label text-muted-foreground">On this page</span>
            <span className="truncate text-sm font-medium" title={pageToken.mint} translate="no">
              {pageToken.symbol}
            </span>
          </span>
          <button
            type="button"
            onClick={() =>
              setDraft(
                draft.from.mint === pageToken.mint
                  ? { from: SOL_PICK, to: pageToken, amountText: "" }
                  : { to: pageToken },
              )
            }
            className={buttonVariants({ size: "sm" })}
          >
            Trade it
          </button>
        </div>
      ) : null}
      <SourcePicker source={draft.source} ghosts={ghosts} site={site} />
      <Card>
        <FromPicker draft={draft} ghostMoney={ghostMoney} heldOf={heldOf} />
        <AmountField
          id={ids.amount}
          noteId={ids.amountNote}
          asset={{ ...draft.from, places: 4 }}
          value={draft.amountText}
          onChange={(amountText) => setDraft({ amountText })}
          most={most}
          invalid={
            problem !== null &&
            ["amount", "short", "ghost-short", "sol-for-fee"].includes(problem.kind)
          }
          note={problem ? <AmountProblem problem={problem} draft={draft} /> : null}
        />
        <div className="flex justify-center">
          <button
            type="button"
            aria-label="Swap the two tokens"
            title="Swap the two tokens"
            disabled={!draft.to}
            onClick={() => draft.to && setDraft({ from: draft.to, to: draft.from, amountText: "" })}
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowDownIcon strokeWidth={1.75} />
          </button>
        </div>
        <ToPicker site={site} draft={draft} />
        <QuoteLine quote={quote} draft={draft} feeMinimum={terms.tradeFeeMinimum} />
      </Card>
      <SlippagePicker value={draft.slippageBps} />
      {problem ? <FormProblemCard problem={problem} draft={draft} /> : null}
      {state.failure ? <PrepareFailure facts={state.failure} words={TRADE_FAILURE_WORDS} /> : null}
      <button
        type="submit"
        disabled={state.preparing}
        className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
      >
        {state.preparing ? (
          <>
            <LoaderCircleIcon className="animate-spin" strokeWidth={1.75} />
            Preparing…
          </>
        ) : (
          "Review"
        )}
      </button>
      <p className="px-1 text-label text-pretty text-muted-foreground">
        {draft.source.kind === "ghost"
          ? "zSol's fee is 1.5% in SOL, from the ghost wallet, which also pays its network fee."
          : `zSol's fee is 1% in SOL, at least ${sol(terms.tradeFeeMinimum)}, and zSol pays the network fee.`}
      </p>
    </form>
  );
}

/** A new token account's rent, about: Max keeps it, since the trade may open one. */
const NEW_ACCOUNT_ROOM = 1_500_000n;

const pickSource = (next: TradeSource) =>
  setDraft({ source: next, from: SOL_PICK, amountText: "" });

function SourcePicker({
  source,
  ghosts,
  site,
}: {
  readonly source: TradeSource;
  readonly ghosts: readonly GhostRow[];
  readonly site: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-label font-medium text-muted-foreground">Trade from</legend>
      <div className="flex flex-col gap-2">
        <Choice
          name="trade-source"
          checked={source.kind === "private"}
          onPick={() => pickSource({ kind: "private" })}
          title="Private balance"
          detail="The swap shows in public from your zSol address; what else you hold stays hidden."
        />
        {ghosts.map((ghost) => (
          <Choice
            key={ghost.address}
            name="trade-source"
            checked={source.kind === "ghost" && source.address === ghost.address}
            onPick={() => pickSource({ kind: "ghost", index: ghost.index, address: ghost.address })}
            title={`Ghost ${String(ghost.index + 1)}`}
            detail={`${short(ghost.address)} · ${ghost.sol === null ? "unread" : `${formatAbout(ghost.sol, 9, 4)} SOL`}`}
          />
        ))}
      </div>
      {ghosts.length === 0 ? (
        <p className="text-label text-pretty text-muted-foreground">
          A ghost wallet trades in public with nothing on chain tying it to you.{" "}
          <a
            href={`${site}/trade`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            Make one on zsol.cc
          </a>
          .
        </p>
      ) : null}
    </fieldset>
  );
}

function Choice({
  name,
  checked,
  onPick,
  title,
  detail,
}: {
  readonly name: string;
  readonly checked: boolean;
  readonly onPick: () => void;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        checked ? "border-primary bg-frost" : "border-border hover:bg-muted/50",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onPick} className="sr-only" />
      <span className="text-sm font-medium">{title}</span>
      <span className="truncate text-label text-muted-foreground">{detail}</span>
    </label>
  );
}

function FromPicker({
  draft,
  ghostMoney,
  heldOf,
}: {
  readonly draft: TradeDraft;
  readonly ghostMoney: PublicMoney | null;
  readonly heldOf: (mint: string) => bigint | null;
}) {
  const wallet = useWallet();
  const picks: TradePick[] =
    draft.source.kind === "private"
      ? (wallet.kind === "open" ? (wallet.balances ?? []) : [])
          .filter((balance) => balance.asset.mint === PRIVATE_SOL || balance.amount > 0n)
          .map((balance) => ({
            mint: balance.asset.mint,
            symbol: balance.asset.symbol,
            decimals: balance.asset.decimals,
          }))
      : [
          SOL_PICK,
          ...(ghostMoney?.tokens ?? [])
            .filter((token) => token.amount > 0n && !token.wrapped)
            .map((token) => ({
              mint: token.mint,
              symbol:
                WALLET_ASSETS.find((asset) => asset.mint === token.mint)?.symbol ??
                short(token.mint),
              decimals: token.decimals,
            })),
        ];
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-label font-medium text-muted-foreground">You pay</legend>
      <div className="grid grid-cols-2 gap-2">
        {picks.map((pick) => {
          const amount = heldOf(pick.mint);
          return (
            <label
              key={pick.mint}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                pick.mint === draft.from.mint
                  ? "border-primary bg-frost"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <input
                type="radio"
                name="trade-from"
                checked={pick.mint === draft.from.mint}
                onChange={() => setDraft({ from: pick, amountText: "" })}
                className="sr-only"
              />
              <span className="truncate text-sm font-medium" title={pick.mint} translate="no">
                {pick.symbol}
              </span>
              <span className="text-label text-muted-foreground tabular-nums">
                {amount === null ? "Reading…" : `${formatAbout(amount, pick.decimals, 4)} held`}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function ToPicker({ site, draft }: { readonly site: string; readonly draft: TradeDraft }) {
  const [query, setQuery] = useState("");
  // Searching only when asked for: a token picked anywhere shows as picked.
  const [open, setOpen] = useState(false);
  const found = useTokenSearch(site, query);
  const inputId = useId();
  const quick: TradePick[] = [
    SOL_PICK,
    ...WALLET_ASSETS.filter((asset) => asset.mint !== PRIVATE_SOL).map((asset) => ({
      mint: asset.mint,
      symbol: asset.symbol,
      decimals: asset.decimals,
    })),
  ].filter((pick) => pick.mint !== draft.from.mint);
  const choose = (pick: TradePick) => {
    setDraft({ to: pick });
    setQuery("");
    setOpen(false);
  };
  if (draft.to && !open) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-label font-medium text-muted-foreground">You get</span>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium" translate="no">
              {draft.to.symbol}
            </span>
            <span
              className="truncate font-mono text-label text-muted-foreground"
              title={draft.to.mint}
            >
              {short(draft.to.mint)}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Change
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-label font-medium text-muted-foreground">
        You get
      </label>
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.75}
        />
        <input
          id={inputId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a token, or paste its mint"
          autoComplete="off"
          spellCheck={false}
          className="h-10 w-full rounded-lg border border-input bg-transparent pr-9 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {draft.to ? (
          <button
            type="button"
            aria-label="Keep the token picked"
            title="Keep the token picked"
            onClick={() => setOpen(false)}
            className={buttonVariants({
              variant: "ghost",
              size: "icon-sm",
              className: "absolute top-1/2 right-1 -translate-y-1/2",
            })}
          >
            <XIcon strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      {query.trim().length < 2 ? (
        <div className="flex flex-wrap gap-2">
          {quick.map((pick) => (
            <button
              key={pick.mint}
              type="button"
              onClick={() => choose(pick)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
              translate="no"
            >
              {pick.symbol}
            </button>
          ))}
        </div>
      ) : found.kind === "searching" ? (
        <p className="text-label text-muted-foreground">Searching…</p>
      ) : found.kind === "failed" ? (
        <p role="alert" className="text-label text-destructive">
          {ROUTE_WORDS[found.code]}
        </p>
      ) : found.kind === "found" && found.tokens.length === 0 ? (
        <p className="text-label text-muted-foreground">No token found. Paste its mint address.</p>
      ) : found.kind === "found" ? (
        <ul
          aria-label="Tokens found"
          className="flex max-h-56 flex-col overflow-y-auto rounded-lg border border-border"
        >
          {found.tokens
            .filter((token) => token.mint !== draft.from.mint)
            .map((token) => (
              <li key={token.mint}>
                <button
                  type="button"
                  onClick={() =>
                    choose({ mint: token.mint, symbol: token.symbol, decimals: token.decimals })
                  }
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50 focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium" translate="no">
                      {token.symbol}
                      {token.verified ? null : (
                        <span className="ml-2 text-label font-normal text-warn">Unverified</span>
                      )}
                    </span>
                    <span className="truncate text-label text-muted-foreground">
                      {token.name ?? short(token.mint)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-label text-muted-foreground">
                    {short(token.mint)}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

function QuoteLine({
  quote,
  draft,
  feeMinimum,
}: {
  readonly quote: LiveQuote;
  readonly draft: TradeDraft;
  readonly feeMinimum: bigint;
}) {
  if (!draft.to || quote.kind === "none") return null;
  if (quote.kind === "asking") {
    return <p className="text-label text-muted-foreground">Asking Jupiter for a price…</p>;
  }
  if (quote.kind === "failed") {
    return <output className="text-label text-pretty text-warn">{ROUTE_WORDS[quote.code]}</output>;
  }
  const read = readAmount(draft.amountText, draft.from.decimals);
  const side = read.ok
    ? feeSideOf({ from: draft.from.mint, to: draft.to.mint, amount: read.amount }, quote.quote)
    : null;
  const fee =
    side === null
      ? null
      : draft.source.kind === "ghost"
        ? ghostTradeFee(side)
        : tradeFee(side, feeMinimum);
  const impact = quote.quote.priceImpactPercent;
  return (
    <div className="flex flex-col gap-1 border-t border-border/70 pt-3 text-label text-pretty">
      <span className="text-base font-semibold tabular-nums">
        About {formatAmount(quote.quote.outAmount, draft.to.decimals)}{" "}
        <span translate="no">{draft.to.symbol}</span>
      </span>
      <span className="text-muted-foreground">
        {fee === null ? "" : `zSol's fee about ${sol(fee)}. `}
        {impact !== null && impact >= 1 ? (
          <span className={impact >= 5 ? "text-destructive" : "text-warn"}>
            Price impact {impact.toFixed(2)}%.{" "}
          </span>
        ) : null}
        {quote.quote.route.length > 0 ? `Through ${quote.quote.route.join(", ")}.` : ""}
      </span>
    </div>
  );
}

function SlippagePicker({ value }: { readonly value: number }) {
  return (
    <fieldset className="flex flex-col gap-1.5 px-1">
      <legend className="mb-1.5 text-label font-medium text-muted-foreground">
        The most the price may move while it's sent
      </legend>
      <div className="grid grid-cols-4 gap-2">
        {SLIPPAGES.map((bps) => (
          <label
            key={bps}
            className={cn(
              "flex cursor-pointer items-center justify-center rounded-lg border py-1.5 text-sm transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              bps === value ? "border-primary bg-frost" : "border-border hover:bg-muted/50",
            )}
          >
            <input
              type="radio"
              name="trade-slippage"
              checked={bps === value}
              onChange={() => setDraft({ slippageBps: bps })}
              className="sr-only"
            />
            {percent(bps)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AmountProblem({
  problem,
  draft,
}: {
  readonly problem: FormProblem;
  readonly draft: TradeDraft;
}) {
  const show = (value: bigint) =>
    `${formatAmount(value, draft.from.decimals)} ${draft.from.symbol}`;
  switch (problem.kind) {
    case "amount":
      return (
        <ProblemLine text={AMOUNT_WORDS[problem.problem](draft.from.symbol, draft.from.decimals)} />
      );
    case "short": {
      const extra = problem.fee + problem.rent;
      return (
        <ProblemLine
          text={
            problem.held === 0n
              ? `This holds no ${draft.from.symbol}.`
              : `This holds ${show(problem.held)}.`
          }
          next={
            extra > 0n
              ? `This needs ${sol(problem.amount + extra)}: ${sol(problem.amount)}, zSol's fee of ${sol(problem.fee)}${problem.rent > 0n ? ` and ${sol(problem.rent)} to open your account for ${draft.to?.symbol ?? "the token"}` : ""}.`
              : `This needs ${show(problem.amount)}.`
          }
          action={
            problem.most > 0n ? (
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    amountText: plainAmount(problem.most, draft.from.decimals),
                  })
                }
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: "self-start",
                })}
              >
                Trade the most you can: {show(problem.most)}
              </button>
            ) : null
          }
        />
      );
    }
    case "ghost-short":
      return (
        <ProblemLine
          text={`The ghost wallet holds ${sol(problem.held)}; this needs ${sol(problem.needed)}.`}
          next={
            isSol(draft.from.mint)
              ? "That's the amount, zSol's 1.5% and 0.005 SOL it keeps for the accounts a swap opens and its fees."
              : "A sale needs 0.0022 SOL in the ghost wallet for the account it opens and its fees."
          }
        />
      );
    case "sol-for-fee":
      return (
        <ProblemLine
          text={`Neither side is SOL, so zSol's fee and any new account come from your private SOL: ${sol(problem.needed)}.`}
          next={`Your private balance holds ${sol(problem.held)}. Go dark with a little SOL first.`}
        />
      );
    default:
      return null;
  }
}

function FormProblemCard({
  problem,
  draft,
}: {
  readonly problem: FormProblem;
  readonly draft: TradeDraft;
}) {
  switch (problem.kind) {
    case "paused":
      return <Paused why={problem.why} />;
    case "no-token":
      return (
        <Card>
          <ProblemLine text="Pick the token you get." />
        </Card>
      );
    case "same-token":
      return (
        <Card>
          <ProblemLine text="Pick two different tokens." />
        </Card>
      );
    case "not-private":
      return (
        <Card>
          <ProblemLine
            text={`Your private balance can't hold ${problem.symbol}.`}
            next="The private pool doesn't take this token. Trade it from a ghost wallet instead."
          />
        </Card>
      );
    case "route":
      return (
        <Card>
          <ProblemLine text={ROUTE_WORDS[problem.code]} next="Nothing was signed." />
        </Card>
      );
    case "changed":
      return (
        <Card>
          <ProblemLine
            text="The swap zSol built isn't the one this panel asked for, so it wasn't signed."
            next="Nothing moved. Prepare it again; if it keeps happening, trade on zsol.cc."
          />
        </Card>
      );
    case "public-input":
      return (
        <Card>
          <ProblemLine
            text={`Your zSol address already holds ${draft.from.symbol} in public.`}
            next="Move it to private first, then trade."
            action={
              <a
                href="#/move"
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: "self-start",
                })}
              >
                Move to private
              </a>
            }
          />
        </Card>
      );
    case "too-small":
      return (
        <Card>
          <ProblemLine
            text="This sale brings less SOL than zSol's fee and the accounts it opens."
            next="Trade a larger amount."
          />
        </Card>
      );
    default:
      return null;
  }
}

function ReviewCard({
  review: built,
  signInWallet,
}: {
  readonly review: Review;
  readonly signInWallet: string;
}) {
  const ghost = built.source.kind === "ghost";
  const pays = `${formatAmount(built.amount, built.from.decimals)} ${built.from.symbol}`;
  const gets = `${formatAmount(built.minOut, built.to.decimals)} ${built.to.symbol}`;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-center gap-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-label text-muted-foreground">You pay</span>
            <span className="truncate font-display text-xl font-semibold tabular-nums">{pays}</span>
          </span>
          <ArrowRightIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
          <span className="flex min-w-0 flex-1 flex-col items-end">
            <span className="text-label text-muted-foreground">You get at least</span>
            <span className="truncate font-display text-xl font-semibold tabular-nums">{gets}</span>
          </span>
        </div>
        <div className="flex flex-col gap-1 text-label text-pretty text-muted-foreground">
          <span>
            Expected about {formatAmount(built.outQuoted, built.to.decimals)} {built.to.symbol}, at
            most {percent(built.slippageBps)} less if the price moves.
          </span>
          <span>
            {ghost
              ? `zSol's fee is ${sol(built.fee)}, from the ghost wallet, which also pays its network fee.`
              : `zSol's fee is ${sol(built.fee)}, and zSol pays the network fee.`}
          </span>
          {built.rent > 0n ? (
            <span>
              Opening your account for {built.to.symbol} takes {sol(built.rent)} from your private
              SOL, once.
            </span>
          ) : null}
          {built.priceImpactPercent !== null && built.priceImpactPercent >= 1 ? (
            <span className={built.priceImpactPercent >= 5 ? "text-destructive" : "text-warn"}>
              Price impact {built.priceImpactPercent.toFixed(2)}%.
            </span>
          ) : null}
        </div>
        <PublicAndHidden
          seen={
            ghost
              ? `Ghost ${String(built.source.kind === "ghost" ? built.source.index + 1 : 0)} swapped ${pays} for ${built.to.symbol}: the amounts and the tokens.`
              : `Your zSol address swapped ${pays} for ${built.to.symbol}: the amounts and the tokens.`
          }
          hidden={
            ghost
              ? "Who the ghost wallet belongs to: nothing on chain ties it to you."
              : "What else your private balance holds, and where it goes next."
          }
        />
      </Card>
      <ReviewActions
        builtAt={built.builtAt}
        confirmLabel={ghost ? "Swap" : "Trade"}
        onConfirm={() => void confirm()}
        onRebuild={() => {
          edit();
          void review(signInWallet);
        }}
        onBack={back}
      />
    </div>
  );
}
