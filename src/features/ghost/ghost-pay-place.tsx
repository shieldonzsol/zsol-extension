import { useEffect, useId, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  AddressField,
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
  ReviewButton,
  Sending,
  short,
  useHeld,
  type FailureWords,
} from "@/features/action/parts";
import { warmTerms } from "@/features/action/terms";
import { AMOUNT_WORDS } from "@/features/action/words";
import { plainAmount } from "@/features/rings/amount-input";
import { formatAmount } from "@/features/rings/amounts";
import { SOL } from "@/features/rings/holdings";
import { SendWays } from "@/features/send/send-ways";
import { useWallet } from "@/features/wallet/wallet-store";
import { cn } from "@/lib/utils";

import {
  another,
  back,
  checkAgain,
  confirm,
  edit,
  ghostPayMost,
  review,
  setDraft,
  useGhostPay,
  useGhostPayDraft,
  type FormProblem,
  type GhostPayState,
  type Review,
} from "./ghost-pay-store";
import type { PoolStopCode } from "./pool-api";
import { DEPOSIT_COST_LAMPORTS, PLAN_NAMES, type PlannedPart, type PlanName } from "./pool-plan";

const sol = (lamports: bigint) => `${formatAmount(lamports, 9)} SOL`;

const PLAN_WORDS: Record<PlanName, { readonly title: string; readonly body: string }> = {
  hour: { title: "In about an hour", body: "One payout. The plan for small amounts." },
  hour3: {
    title: "3 parts over about an hour",
    body: "Rising parts. Hides more, costs a little more.",
  },
  day5: { title: "5 parts over about a day", body: "Rising parts. Hides the most." },
  two: { title: "2 parts within 10 minutes", body: "A small part soon, the rest a little later." },
  now: {
    title: "At once",
    body: "The same amount leaves seconds after it went in. Hides the least.",
  },
};

const POOL_WORDS: Record<PoolStopCode, string> = {
  listed: "This address is on a sanctions list, so zSol can't pay it.",
  "too-small": "A part would be below Ghost Route's smallest payout.",
  "too-many": "That's more parts than one plan pays.",
  "no-shield": "This receiver can't take it into a private balance right now.",
  unavailable: "Ghost Route is off on zSol right now.",
  "signed-out": "Your sign-in ended. Sign the panel in again.",
  busy: "Too many requests just now. Wait a moment, then try again.",
  unreachable: "Ghost Route couldn't be reached.",
  refused: "Ghost Route refused this deposit.",
  "over-limit": "That's more than Ghost Route takes in one deposit.",
  short: "Your zSol address doesn't hold enough for the deposit.",
  "failed-on-chain": "The deposit failed on Solana.",
  "status-unknown": "The deposit's answer never arrived.",
  mismatch: "zSol's server sent back a different deposit.",
  unknown: "Ghost Route's answer couldn't be read.",
};

const GHOST_PAY_FAILURE_WORDS: FailureWords = {
  unanswered: {
    title: "The deposit went out, and its answer never arrived.",
    body: "It may be in Ghost Route: zSol starts the payouts if it landed. Check your wallet before you pay again.",
  },
};

export function GhostPayPlace({
  site,
  signInWallet,
}: {
  readonly site: string;
  readonly signInWallet: string;
}) {
  const wallet = useWallet();
  const state = useGhostPay();
  useEffect(() => {
    void warmTerms(site);
  }, [site]);
  return (
    <div className="flex flex-col gap-4 p-4">
      <SendWays current="ghost-pay" />
      <Heading
        title="Ghost pay"
        body="Your private wallet pays into Ghost Route in public. Later it pays their address. Nothing on chain ties your private wallet to them."
      />
      {wallet.kind !== "open" || wallet.balances === null ? (
        <NotOpenYet what="Ghost pay" />
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
  readonly state: GhostPayState;
  readonly site: string;
  readonly signInWallet: string;
}) {
  if (state.kind === "form") return <PayForm state={state} signInWallet={signInWallet} />;
  if (state.kind === "review")
    return <ReviewCard review={state.review} signInWallet={signInWallet} />;
  if (state.kind === "sending") return <Sending order={state.order} site={site} />;
  if (state.kind === "done") {
    const done = state.review;
    return (
      <div className="flex flex-col gap-4">
        <Done
          title="It's in Ghost Route."
          body={`${sol(done.amount)} for ${short(done.to)}: ${partsWords(done.parts.length)}, ${done.shielded ? "into their private balance" : "at their address"}. zSol pays them out at each part's time, with this panel closed.`}
          order={state.order}
          signature={state.signature}
          site={site}
          again="Ghost pay again"
          onAgain={another}
        />
        <Schedule parts={done.parts} from={state.review.builtAt} />
      </div>
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
      decimals={9}
      onTryAgain={() => {
        edit();
        void review(signInWallet);
      }}
      onCheckAgain={() => void checkAgain()}
      onChange={edit}
      changeLabel="Change the payment"
      words={GHOST_PAY_FAILURE_WORDS}
    />
  );
}

const partsWords = (count: number) => (count === 1 ? "one payout" : `${String(count)} payouts`);

function PayForm({
  state,
  signInWallet,
}: {
  readonly state: Extract<GhostPayState, { kind: "form" }>;
  readonly signInWallet: string;
}) {
  const draft = useGhostPayDraft();
  const held = useHeld();
  const ids = { to: useId(), toNote: useId(), amount: useId(), amountNote: useId() };
  const { problem } = state;
  const toProblem =
    problem && ["to-empty", "bad-address", "own", "listed"].includes(problem.kind) ? problem : null;
  const amountProblem =
    problem && ["amount", "short", "too-small"].includes(problem.kind) ? problem : null;
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
        <AddressField
          id={ids.to}
          noteId={ids.toNote}
          label="To"
          placeholder="Their Solana address"
          value={draft.to}
          onChange={(to) => setDraft({ to, ghost: null })}
          invalid={toProblem !== null}
          note={
            toProblem ? (
              <Problem problem={toProblem} />
            ) : draft.ghost === null ? null : (
              <span className="text-muted-foreground">
                Ghost {String(draft.ghost + 1)}: one of your ghost wallets. Fund it ahead of time:
                money that lands seconds before a trade is easy to match by size and time.
              </span>
            )
          }
        />
        <AmountField
          id={ids.amount}
          noteId={ids.amountNote}
          asset={SOL}
          value={draft.amountText}
          onChange={(amountText) => setDraft({ amountText })}
          most={ghostPayMost(held(SOL.mint))}
          invalid={amountProblem !== null}
          note={
            amountProblem ? (
              <Problem problem={amountProblem} />
            ) : (
              <span className="text-muted-foreground">
                SOL only. The deposit costs about {sol(DEPOSIT_COST_LAMPORTS)} on top, and Ghost
                Route keeps a small part of each payout.
              </span>
            )
          }
        />
      </Card>
      <PlanPicker value={draft.plan} />
      <label className="flex items-start gap-2 px-1 text-label text-pretty">
        <input
          type="checkbox"
          checked={draft.shield}
          onChange={(event) => setDraft({ shield: event.target.checked })}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Into their private balance when they're on zSol.</span>{" "}
          <span className="text-muted-foreground">Off: it lands at their address, in public.</span>
        </span>
      </label>
      {problem?.kind === "paused" ? <Paused why={problem.why} /> : null}
      {problem?.kind === "pool" ? (
        <Card>
          <ProblemLine text={POOL_WORDS[problem.code]} next="Nothing was signed." />
        </Card>
      ) : null}
      {state.failure ? <PrepareFailure facts={state.failure} /> : null}
      <ReviewButton preparing={state.preparing} />
    </form>
  );
}

function PlanPicker({ value }: { readonly value: PlanName | null }) {
  const [open, setOpen] = useState(value !== null);
  if (!open) {
    return (
      <div className="flex items-center justify-between gap-3 px-1 text-label">
        <span className="text-muted-foreground">
          Paid out by the plan that suits the amount: more parts for more SOL.
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Pick a plan
        </button>
      </div>
    );
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 px-1 text-label font-medium text-muted-foreground">
        How it's paid out
      </legend>
      {PLAN_NAMES.map((name) => (
        <label
          key={name}
          className={cn(
            "flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
            value === name ? "border-primary bg-frost" : "border-border hover:bg-muted/50",
          )}
        >
          <input
            type="radio"
            name="ghost-plan"
            checked={value === name}
            onChange={() => setDraft({ plan: name })}
            className="sr-only"
          />
          <span className="text-sm font-medium">{PLAN_WORDS[name].title}</span>
          <span className="text-label text-muted-foreground">{PLAN_WORDS[name].body}</span>
        </label>
      ))}
    </fieldset>
  );
}

function Problem({ problem }: { readonly problem: FormProblem }) {
  switch (problem.kind) {
    case "to-empty":
      return <ProblemLine text="Add the address it goes to." />;
    case "bad-address":
      return (
        <ProblemLine
          text="That isn't a Solana address."
          next="A Solana address is 32 to 44 letters and digits. Check it was copied in full."
        />
      );
    case "own":
      return (
        <ProblemLine
          text="That's your own zSol address."
          next="Ghost pay is for someone else's address. Pick the wallet it should reach."
        />
      );
    case "listed":
      return (
        <ProblemLine text={POOL_WORDS.listed} next="Nothing was signed. Pay another address." />
      );
    case "amount":
      return <ProblemLine text={AMOUNT_WORDS[problem.problem]("SOL", 9)} />;
    case "short": {
      const most = ghostPayMost(problem.held);
      return (
        <ProblemLine
          text={`Your private balance holds ${sol(problem.held)}; this needs ${sol(problem.needed)}.`}
          next="That's the amount, the deposit's cost and its network fee."
          action={
            most > 0n ? (
              <button
                type="button"
                onClick={() => setDraft({ amountText: plainAmount(most, 9) })}
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: "self-start",
                })}
              >
                Pay the most you can: {sol(most)}
              </button>
            ) : null
          }
        />
      );
    }
    case "too-small":
      return (
        <ProblemLine
          text={`Each part must be at least Ghost Route's smallest payout: ${sol(problem.least)} for ${partsWords(problem.parts)}.`}
          next={problem.parts > 1 ? "Pay more, or pick a plan with fewer parts." : "Pay more."}
          action={
            <button
              type="button"
              onClick={() => setDraft({ amountText: plainAmount(problem.least, 9) })}
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "self-start",
              })}
            >
              Pay {sol(problem.least)}
            </button>
          }
        />
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
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-1">
          <span className="text-label text-muted-foreground">They receive, in all</span>
          <span className="font-display text-xl font-semibold tabular-nums">
            {sol(built.received)}
          </span>
          <span className="text-label text-muted-foreground">
            {short(built.to)} · {partsWords(built.parts.length)} ·{" "}
            {built.shielded ? "into their private balance" : "at their address, in public"}
          </span>
        </div>
        <Schedule parts={built.parts} from={built.builtAt} />
        <div className="flex flex-col gap-1 border-t border-border/70 pt-3 text-label text-pretty text-muted-foreground">
          <span>
            Leaves your private balance: {sol(built.leaves + built.unshieldFee)}. That's{" "}
            {sol(built.amount)}, the deposit's cost of about {sol(built.leaves - built.amount)} and
            its network fee of {sol(built.unshieldFee)}.
          </span>
          <span>Ghost Route keeps {sol(built.poolFee)} of the payouts. No fee of zSol's.</span>
          {built.poolFee * 10n > built.amount ? (
            <span className="text-warn">
              That's {String(Number((built.poolFee * 1000n) / built.amount) / 10)}% of the amount:
              Ghost Route keeps a flat part of every payout, so a small amount loses more. Fewer
              parts, or a larger amount, lose less.
            </span>
          ) : null}
        </div>
        <PublicAndHidden
          seen={`Your zSol address paid ${sol(built.amount)} into Ghost Route; later Ghost Route pays ${short(built.to)}.`}
          hidden="That the two are the same money: nothing on chain ties your private wallet to them."
        />
      </Card>
      <ReviewActions
        builtAt={built.builtAt}
        confirmLabel="Ghost pay"
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

const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const DAY_TIME = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

function when(at: number, now: number): string {
  if (at - now < 60_000) return "At once";
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  return `About ${(sameDay ? TIME : DAY_TIME).format(new Date(at))}`;
}

function Schedule({
  parts,
  from,
}: {
  readonly parts: readonly PlannedPart[];
  readonly from: number;
}) {
  return (
    <ol aria-label="Payouts" className="flex flex-col gap-1">
      {parts.map((part, index) => (
        <li
          key={`${String(index)}-${String(part.afterMs)}`}
          className="flex items-baseline justify-between gap-3 text-sm"
        >
          <span className="text-muted-foreground">{when(from + part.afterMs, from)}</span>
          <span className="tabular-nums">{sol(part.received)}</span>
        </li>
      ))}
    </ol>
  );
}
