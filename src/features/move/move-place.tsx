import { ArrowLeftIcon, CheckIcon, CopyIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { placeHref } from "@/app/places";
import { buttonVariants } from "@/components/ui/button";
import {
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
  type FailureWords,
} from "@/features/action/parts";
import { warmTerms } from "@/features/action/terms";
import { formatAmount } from "@/features/rings/amounts";
import { holdsMoney, type StayingToken } from "@/features/rings/sweep";
import { useWallet } from "@/features/wallet/wallet-store";

import { moneyLines, STAY_WORDS, summaryOf, tokenLine, type MoneyLine } from "./money-words";
import {
  back,
  checkAgain,
  confirm,
  edit,
  movedLines,
  review,
  useMove,
  type FormProblem,
  type MoveState,
  type Review,
} from "./move-store";
import { usePublicMoney } from "./public-money";

const sol = (lamports: bigint) => `${formatAmount(lamports, 9)} SOL`;

const MOVE_FAILURE_WORDS: FailureWords = {
  "failed-on-chain": {
    title: "It reached Solana and failed there. Nothing moved.",
    body: "What your zSol address holds is as it was. Try again.",
  },
  failed: {
    title: "It didn't go through. Nothing moved.",
    body: "What your zSol address holds is as it was. Try again.",
  },
  stale: {
    title: "Something changed while it was being prepared. Nothing moved.",
    body: "Prepare it again with the figures as they are now.",
  },
  "signed-out": {
    title: "Your sign-in ended, so zSol can't take the move.",
    body: "Nothing moved. Sign the panel in again, then try again.",
  },
};

/** Starts a move from anywhere: prepared at once, its review on the move place. */
export function startMove(signInWallet: string) {
  window.location.hash = placeHref("move");
  void review(signInWallet);
}

export function MovePlace({
  site,
  signInWallet,
}: {
  readonly site: string;
  readonly signInWallet: string;
}) {
  const wallet = useWallet();
  const state = useMove();
  useEffect(() => {
    void warmTerms(site);
  }, [site]);
  return (
    <div className="flex flex-col gap-4 p-4">
      <a
        href={placeHref("wallet")}
        className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2 self-start" })}
      >
        <ArrowLeftIcon data-icon="inline-start" strokeWidth={1.75} />
        Wallet
      </a>
      <Heading
        title="Move to private"
        body="Everything public at your zSol address goes into your private balance, in one transaction."
      />
      {wallet.kind !== "open" || wallet.balances === null ? (
        <NotOpenYet what="Move to private" />
      ) : (
        <Stage
          state={state}
          site={site}
          signInWallet={signInWallet}
          address={wallet.address ?? ""}
        />
      )}
    </div>
  );
}

function Stage({
  state,
  site,
  signInWallet,
  address,
}: {
  readonly state: MoveState;
  readonly site: string;
  readonly signInWallet: string;
  readonly address: string;
}) {
  if (state.kind === "form") {
    return <MoveForm state={state} signInWallet={signInWallet} address={address} />;
  }
  if (state.kind === "review") {
    return <ReviewCard review={state.review} signInWallet={signInWallet} />;
  }
  if (state.kind === "sending") return <Sending order={state.order} site={site} />;
  if (state.kind === "done") {
    return (
      <Done
        title="Moved. It's in your private balance."
        body={`${summaryOf(movedLines(state.review))} from your zSol address. Your balance is up to date.`}
        order={state.order}
        signature={state.signature}
        site={site}
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
      amount={0n}
      decimals={9}
      onTryAgain={() => {
        edit();
        void review(signInWallet);
      }}
      onCheckAgain={() => void checkAgain()}
      onChange={edit}
      changeLabel="Back"
      words={MOVE_FAILURE_WORDS}
    />
  );
}

function MoveForm({
  state,
  signInWallet,
  address,
}: {
  readonly state: Extract<MoveState, { kind: "form" }>;
  readonly signInWallet: string;
  readonly address: string;
}) {
  const shown = usePublicMoney();
  const { problem } = state;
  const lines = shown.money ? moneyLines(shown.money) : [];
  const again = () => void review(signInWallet);
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        again();
      }}
    >
      {problem ? (
        <ProblemCard problem={problem} address={address} onAgain={again} />
      ) : (
        <Card>
          {lines.length > 0 ? (
            <Lines title="At your zSol address now" lines={lines} />
          ) : (
            <p className="text-sm text-pretty text-muted-foreground">
              {shown.money && !holdsMoney(shown.money)
                ? "Your zSol address holds nothing in public right now."
                : "Review reads what your zSol address holds, and what moving it takes."}
            </p>
          )}
        </Card>
      )}
      {state.failure ? <PrepareFailure facts={state.failure} words={MOVE_FAILURE_WORDS} /> : null}
      {problem?.kind === "paused" ? null : (
        <button
          type="submit"
          disabled={state.preparing}
          className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
        >
          {state.preparing ? (
            <>
              <LoaderCircleIcon className="animate-spin" strokeWidth={1.75} />
              Reading your zSol address…
            </>
          ) : problem ? (
            "Check again"
          ) : (
            "Review"
          )}
        </button>
      )}
    </form>
  );
}

function ProblemCard({
  problem,
  address,
  onAgain,
}: {
  readonly problem: FormProblem;
  readonly address: string;
  readonly onAgain: () => void;
}) {
  switch (problem.kind) {
    case "paused":
      return (
        <>
          <Paused why={problem.why} />
          <button
            type="button"
            onClick={onAgain}
            className={buttonVariants({ variant: "outline", size: "lg", className: "h-10 w-full" })}
          >
            Check again
          </button>
        </>
      );
    case "nothing":
      return (
        <Card>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-pretty">
              {problem.staying.length > 0
                ? "Nothing here can move into your private balance."
                : "Your zSol address is empty: there's nothing to move."}
            </p>
            {problem.staying.length > 0 ? null : (
              <p className="text-label text-pretty text-muted-foreground">
                Money sent to it from outside zSol shows here until you move it in.
              </p>
            )}
          </div>
          <Staying staying={problem.staying} />
        </Card>
      );
    case "rent-short":
      return (
        <Card>
          <ProblemLine
            text={`Your private wallet has no record yet: creating it and the move's network fee come to ${sol(problem.rent)}. This address holds ${sol(problem.held)}.`}
            next="Send it a little more SOL, then move it."
            action={<CopyAddress address={address} />}
          />
        </Card>
      );
    case "too-small":
      return (
        <Card>
          <ProblemLine
            text={`This address holds ${sol(problem.held)}, less than the move's network fee of ${sol(problem.fee)}.`}
            next="Moving it would cost more than it holds. Send it a little more SOL, then move it."
            action={<CopyAddress address={address} />}
          />
        </Card>
      );
    case "would-fail":
      return (
        <Card>
          <ProblemLine
            text="This move would fail on Solana right now. Nothing was signed."
            next="What your zSol address holds is as it was. Check again in a minute."
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
  const lines = movedLines(built);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <Lines title="Into your private balance" lines={lines} />
        <div className="flex flex-col gap-1 text-label text-pretty text-muted-foreground">
          <span>
            {built.networkFee > 0n
              ? `No fee of zSol's. Its network fee, ${sol(built.networkFee)}, comes out of this money.`
              : "No fee of zSol's, and zSol pays the network fee: there's no SOL here to pay it from."}
          </span>
          {built.registryRent === null ? null : (
            <span className="text-warn">
              It also creates your private wallet's record, so others can pay you privately: a
              one-time rent of {sol(built.registryRent)}, from this money.
            </span>
          )}
          {built.unwrapped > 0n ? (
            <span>
              Its wrapped SOL, {sol(built.unwrapped)}, is unwrapped and comes in with the SOL.
            </span>
          ) : null}
          {built.closesEmpty > 0 ? (
            <span>
              {built.closesEmpty === 1
                ? "An empty token account closes, and its rent comes in with the SOL."
                : `${String(built.closesEmpty)} empty token accounts close, and their rent comes in with the SOL.`}
            </span>
          ) : null}
        </div>
        {built.staying.some((each) => each.token.amount > 0n) ? (
          <div className="flex flex-col gap-2 border-t border-border/70 pt-3">
            <span className="text-label font-medium">Stays at your zSol address</span>
            <Staying staying={built.staying} />
          </div>
        ) : null}
        <PublicAndHidden
          seen="Your zSol address put these amounts into the private pool: the amounts and the tokens, as they were in public here."
          hidden="What you do with it from your private balance."
        />
      </Card>
      <ReviewActions
        builtAt={built.builtAt}
        confirmLabel="Move to private"
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

function Lines({ title, lines }: { readonly title: string; readonly lines: readonly MoneyLine[] }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-label font-medium text-muted-foreground">{title}</span>
      <ul className="flex flex-col gap-1">
        {lines.map((line) => (
          <li key={line.key} className="flex items-baseline justify-between gap-3">
            <span
              className="truncate text-sm text-muted-foreground"
              title={line.mint}
              translate="no"
            >
              {line.symbol}
            </span>
            <span className="shrink-0 text-base font-semibold tabular-nums">{line.amount}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Staying({ staying }: { readonly staying: readonly StayingToken[] }) {
  const shown = staying.filter((each) => each.token.amount > 0n);
  if (shown.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {shown.map(({ token, why }) => {
        const line = tokenLine(token);
        return (
          <li key={token.account} className="flex flex-col gap-0.5">
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate" title={line.mint} translate="no">
                {line.symbol}
              </span>
              <span className="shrink-0 tabular-nums">{line.amount}</span>
            </span>
            <span className="text-label text-pretty text-muted-foreground">{STAY_WORDS[why]}</span>
          </li>
        );
      })}
    </ul>
  );
}

function CopyAddress({ address }: { readonly address: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  if (address === "") return null;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(address).then(() => setCopied(true));
      }}
      className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
    >
      {copied ? (
        <CheckIcon data-icon="inline-start" strokeWidth={1.75} />
      ) : (
        <CopyIcon data-icon="inline-start" strokeWidth={1.75} />
      )}
      {copied ? "Copied" : "Copy your zSol address"}
    </button>
  );
}
