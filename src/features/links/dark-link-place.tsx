import { useEffect, useId, useState } from "react";

import { placeHref } from "@/app/places";
import { buttonVariants } from "@/components/ui/button";
import {
  AmountField,
  Card,
  Failed,
  Heading,
  NotOpenYet,
  Paused,
  PlaceLink,
  PrepareFailure,
  ProblemLine,
  PublicAndHidden,
  ReviewActions,
  ReviewButton,
  Sending,
  short,
  TokenPicker,
  useHeld,
} from "@/features/action/parts";
import { fundingFeeOn, useFeeTerms, warmTerms } from "@/features/action/terms";
import { AMOUNT_WORDS, FAILURE_WORDS } from "@/features/action/words";
import { OrderId } from "@/features/orders/order-tracker";
import { mostWithFee, percentOf, plainAmount, readAmount } from "@/features/rings/amount-input";
import { formatAmount } from "@/features/rings/amounts";
import type { Asset } from "@/features/rings/holdings";
import { darkLinkCode, linkUrl } from "@/features/rings/links";
import { SendWays } from "@/features/send/send-ways";
import { useNow } from "@/features/wallet/use-now";
import { assetFor, linkKey, useWallet } from "@/features/wallet/wallet-store";

import type { LinkRow } from "./link-api";
import {
  another,
  back,
  checkAgain,
  confirm,
  edit,
  review,
  setDraft,
  useDarkLink,
  useDraft,
  type FormProblem,
  type LinkState,
  type Review,
} from "./dark-link-store";
import { CopyLine, useCopied } from "./copy-line";
import { ClaimWords, LINK_DATE, MovedLine } from "./link-words";
import {
  amountsText,
  askTakeBack,
  keepOpen,
  makeGhostLink,
  refreshLinks,
  takeBack,
  useLinks,
  type BackView,
  type GhostLinkMade,
} from "./links-store";

const TITLE = "Dark link";
const BODY =
  "A link that holds any token from your private balance. Whoever opens it claims the money, even if they're new to zSol.";

export function DarkLinkPlace({
  site,
  signInWallet,
}: {
  readonly site: string;
  readonly signInWallet: string;
}) {
  const wallet = useWallet();
  const made = useDarkLink();
  const open = wallet.kind === "open" && wallet.balances !== null;
  useEffect(() => {
    void warmTerms(site);
  }, [site]);
  useEffect(() => {
    if (open) void refreshLinks();
  }, [open]);
  return (
    <div className="flex flex-col gap-4 p-4">
      <SendWays current="dark-link" />
      <Heading title={TITLE} body={BODY} />
      {open ? (
        <>
          <Stage made={made} site={site} signInWallet={signInWallet} />
          <YourLinks site={site} />
          <p className="px-1 text-label text-pretty text-muted-foreground">
            Someone sent you a link? <a href={placeHref("claim")}>Claim it here</a>.
          </p>
        </>
      ) : (
        <NotOpenYet what="Dark link" />
      )}
    </div>
  );
}

function Stage({
  made,
  site,
  signInWallet,
}: {
  readonly made: LinkState;
  readonly site: string;
  readonly signInWallet: string;
}) {
  if (made.kind === "form") return <LinkForm made={made} signInWallet={signInWallet} />;
  if (made.kind === "review")
    return <ReviewCard review={made.review} signInWallet={signInWallet} />;
  if (made.kind === "sending") return <Sending order={made.order} site={site} />;
  if (made.kind === "done") return <Made review={made.review} order={made.order} site={site} />;
  return (
    <Failed
      facts={made.facts}
      checking={made.checking}
      checked={made.checked}
      order={made.order}
      site={site}
      amount={made.review.amount}
      decimals={made.review.asset.decimals}
      onTryAgain={() => {
        edit();
        void review(signInWallet);
      }}
      onCheckAgain={() => void checkAgain()}
      onChange={edit}
      changeLabel="Change the link"
      onSmaller={(amountText) => {
        edit();
        setDraft({ amountText });
      }}
    />
  );
}

/** zSol's fee on a link, as the form and the review read it. */
function linkFeeWords(input: {
  readonly rate: string;
  readonly fee: string | null;
  readonly symbol: string;
  readonly charged: boolean;
}): string {
  if (!input.charged) {
    return "zSol charges no fee on this token, and pays the network fee. Claiming the link, or taking it back, costs nothing.";
  }
  return input.fee === null
    ? `zSol's fee is ${input.rate} or zSol's least fee, and the claim's network fee paid ahead. It's paid now, so claiming the link, or taking it back, costs nothing.`
    : `zSol's fee is ${input.fee} ${input.symbol}: ${input.rate} or zSol's least fee, and the claim's network fee paid ahead. It's paid now, so claiming the link, or taking it back, costs nothing.`;
}

function LinkForm({
  made,
  signInWallet,
}: {
  readonly made: Extract<LinkState, { kind: "form" }>;
  readonly signInWallet: string;
}) {
  const draft = useDraft();
  const terms = useFeeTerms();
  const held = useHeld();
  const ids = { amount: useId(), amountNote: useId() };
  const asset = assetFor(draft.mint);
  const rate = percentOf(terms.sendFeeBps);
  const charged = terms.feeAssets.has(asset.mint);
  const feeOf = (amount: bigint) => fundingFeeOn(asset.mint, amount, terms);
  const most = mostWithFee(held(asset.mint), feeOf);
  const typed = readAmount(draft.amountText, asset.decimals);
  const fee = typed.ok ? feeOf(typed.amount) : null;
  const { problem } = made;
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
        <TokenPicker
          name="link-token"
          picked={asset}
          onPick={(picked) => setDraft({ mint: picked.mint, amountText: "" })}
        />
        <AmountField
          id={ids.amount}
          noteId={ids.amountNote}
          asset={asset}
          value={draft.amountText}
          onChange={(amountText) => setDraft({ amountText })}
          most={most}
          invalid={amountProblem !== null}
          note={
            amountProblem ? (
              <AmountProblemLine problem={amountProblem} asset={asset} />
            ) : (
              <span className="text-muted-foreground">
                {linkFeeWords({
                  rate,
                  fee: fee !== null && fee > 0n ? formatAmount(fee, asset.decimals) : null,
                  symbol: asset.symbol,
                  charged,
                })}
              </span>
            )
          }
        />
      </Card>
      {problem?.kind === "paused" ? <Paused why={problem.why} /> : null}
      {made.failure ? <PrepareFailure facts={made.failure} /> : null}
      <ReviewButton preparing={made.preparing} />
      <ByGhostRoute />
    </form>
  );
}

const GHOST_LINK_WORDS: Record<Exclude<GhostLinkMade, "made">, string> = {
  "signed-out": "Your sign-in ended. Sign the panel in again to make a link.",
  taken: "Another device made a link at the same moment. Nothing was made: try again.",
  failed: "The link couldn't be made just now. Nothing moved.",
};

/** The other way: a link whose money comes through Ghost Route. */
function ByGhostRoute() {
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<Exclude<GhostLinkMade, "made"> | null>(null);
  return (
    <div className="flex flex-col gap-2 border-t border-border/70 px-1 pt-4">
      <span className="text-sm font-medium">Or by Ghost Route</span>
      <p className="text-label text-pretty text-muted-foreground">
        A link whose money comes through Ghost Route, in SOL: nothing on chain ties it to you. The
        amount is public, as with every Ghost Route payout; who made the link is not.
      </p>
      {problem ? <ProblemLine text={GHOST_LINK_WORDS[problem]} /> : null}
      <button
        type="button"
        disabled={making}
        onClick={() => {
          setMaking(true);
          setProblem(null);
          void makeGhostLink().then((made) => {
            setMaking(false);
            if (made !== "made") setProblem(made);
          });
        }}
        className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
      >
        {making ? "Making it…" : "Make a link paid by Ghost Route"}
      </button>
    </div>
  );
}

function AmountProblemLine({
  problem,
  asset,
}: {
  readonly problem: Extract<FormProblem, { kind: "amount" | "short" }>;
  readonly asset: Asset;
}) {
  if (problem.kind === "amount") {
    return <ProblemLine text={AMOUNT_WORDS[problem.problem](asset.symbol, asset.decimals)} />;
  }
  const { short: lack } = problem;
  const show = (value: bigint) => formatAmount(value, asset.decimals);
  return (
    <ProblemLine
      text={
        lack.held === 0n
          ? `Your private balance holds no ${asset.symbol}.`
          : `Your private balance is ${show(lack.short)} ${asset.symbol} short.`
      }
      next={
        lack.fee > 0n
          ? `It holds ${show(lack.held)} ${asset.symbol}. This needs ${show(lack.needed)} ${asset.symbol}: ${show(lack.amount)} plus zSol's fee of ${show(lack.fee)}.`
          : `It holds ${show(lack.held)} ${asset.symbol}. This needs ${show(lack.needed)} ${asset.symbol}.`
      }
      action={
        lack.most > 0n ? (
          <button
            type="button"
            onClick={() => setDraft({ amountText: plainAmount(lack.most, asset.decimals) })}
            className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
          >
            Put in the most you can: {show(lack.most)} {asset.symbol}
          </button>
        ) : null
      }
    />
  );
}

function ReviewCard({
  review: made,
  signInWallet,
}: {
  readonly review: Review;
  readonly signInWallet: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-end justify-between gap-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-label text-muted-foreground">The link holds</span>
            <span className="font-display text-xl font-semibold tabular-nums">
              {formatAmount(made.amount, made.asset.decimals)} {made.asset.symbol}
            </span>
          </span>
          <span className="flex min-w-0 flex-col items-end">
            <span className="text-label text-muted-foreground">Its one-time address</span>
            <span className="font-mono text-sm" title={made.address} translate="no">
              {short(made.address)}
            </span>
          </span>
        </div>
        <p className="text-label text-pretty text-muted-foreground">
          {linkFeeWords({
            rate: percentOf(made.feeBps),
            fee: formatAmount(made.fee, made.asset.decimals),
            symbol: made.asset.symbol,
            charged: made.fee > 0n,
          })}
        </p>
        <PublicAndHidden
          seen="Your zSol address paid a one-time address. Later, that address pays whoever claims the link."
          hidden="The amount and the token."
        />
      </Card>
      <ReviewActions
        builtAt={made.builtAt}
        confirmLabel="Make the link"
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

function Made({
  review: made,
  order,
  site,
}: {
  readonly review: Review;
  readonly order: string;
  readonly site: string;
}) {
  const url = linkUrl(site, made.code);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <output className="flex flex-col gap-1.5">
          <p className="text-base font-semibold text-pretty">Your Dark link is ready</p>
          <p className="text-sm text-pretty text-muted-foreground">
            It holds {formatAmount(made.amount, made.asset.decimals)} {made.asset.symbol}.
          </p>
          <OrderId id={order} />
        </output>
        <CopyLine value={url} label="Copy the link" />
        <p className="text-label text-pretty">
          Anyone who opens this link can claim the money. Send it only to the person it's for.
        </p>
        <p className="text-label text-pretty text-muted-foreground">
          Until someone claims it, you can take it back below.
        </p>
      </Card>
      <button
        type="button"
        onClick={another}
        className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
      >
        Make another
      </button>
    </div>
  );
}

const STATE_WORDS: Record<LinkRow["state"], string> = {
  open: "Not claimed",
  claimed: "Claimed",
  taken_back: "Taken back",
};

/** How many links show before "Show all". */
const FIRST_SHOWN = 5;

function YourLinks({ site }: { readonly site: string }) {
  const { list, back: backView } = useLinks();
  const [all, setAll] = useState(false);
  const rows = list.rows ?? [];
  const shown = all ? rows : rows.slice(0, FIRST_SHOWN);
  return (
    <Card>
      <span className="text-label font-medium text-muted-foreground">Your Dark links</span>
      {list.rows === null && list.kind === "reading" ? (
        <output className="block text-sm text-muted-foreground">Reading your links…</output>
      ) : list.kind === "failed" && list.rows === null ? (
        <div className="flex flex-col gap-2">
          <ProblemLine text="Your links couldn't be read just now." />
          <button
            type="button"
            onClick={() => void refreshLinks()}
            className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
          >
            Read them again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-pretty text-muted-foreground">
          Links you make show here, so you can copy one again or take it back.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/70">
          {shown.map((row) => (
            <LinkLine
              key={row.index}
              row={row}
              site={site}
              back={backView?.index === row.index ? backView : null}
              busy={backView !== null && backView.kind === "moving"}
            />
          ))}
        </ul>
      )}
      {!all && rows.length > FIRST_SHOWN ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className={buttonVariants({ variant: "ghost", size: "sm", className: "self-start" })}
        >
          Show all {rows.length}
        </button>
      ) : null}
    </Card>
  );
}

function LinkLine({
  row,
  site,
  back: backView,
  busy,
}: {
  readonly row: LinkRow;
  readonly site: string;
  readonly back: BackView | null;
  readonly busy: boolean;
}) {
  const [copied, onCopied, failed, onFailed] = useCopied();
  const now = useNow();
  const due = row.arrivesAt !== null && row.arrivesAt > now;
  const copy = async () => {
    const key = await linkKey(row.index);
    if (!key) return;
    try {
      await navigator.clipboard.writeText(linkUrl(site, darkLinkCode(key)));
      onCopied();
    } catch {
      onFailed();
    } finally {
      key.fill(0);
    }
  };
  return (
    <li className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium tabular-nums">
            {LINK_DATE.format(row.createdAt)}
          </span>
          <span className="truncate text-label text-muted-foreground">
            {due && row.arrivesAt !== null
              ? `Ghost Route pays it at about ${LINK_DATE.format(row.arrivesAt)}`
              : STATE_WORDS[row.state]}
          </span>
        </span>
        {row.state === "open" ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void copy()}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <button
              type="button"
              disabled={busy || backView?.kind === "reading"}
              onClick={() => void askTakeBack(row.index)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {backView?.kind === "reading" ? "Reading…" : "Take back"}
            </button>
          </span>
        ) : null}
      </div>
      {failed ? <ProblemLine text="Not copied: try again." /> : null}
      {backView ? <BackLine view={backView} site={site} /> : null}
    </li>
  );
}

function BackLine({ view, site }: { readonly view: BackView; readonly site: string }) {
  if (view.kind === "reading") return null;
  if (view.kind === "unread") {
    return (
      <ProblemLine
        text="This link couldn't be read just now."
        next="Nothing moved. Try again in a moment."
      />
    );
  }
  if (view.kind === "sure") {
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3">
        <p className="text-sm font-medium text-pretty">Take back {amountsText(view.holdings)}?</p>
        <p className="text-label text-pretty text-muted-foreground">
          It moves into your private balance, free, and the link stops working.
        </p>
        <span className="flex gap-2">
          <button
            type="button"
            onClick={() => void takeBack(view.index)}
            className={buttonVariants({ size: "sm" })}
          >
            Take back
          </button>
          <button
            type="button"
            onClick={keepOpen}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Keep it open
          </button>
        </span>
      </div>
    );
  }
  if (view.kind === "moving") {
    return (
      <output className="block text-label text-pretty text-muted-foreground">
        Taking back… <ClaimWords progress={view.progress} />
      </output>
    );
  }
  const { outcome } = view;
  if (outcome.kind === "moved") {
    return (
      <output className="block text-label text-pretty">
        Back in your private balance: {amountsText(outcome.moved)}.
      </output>
    );
  }
  if (outcome.kind === "empty") {
    return (
      <output className="block text-label text-pretty text-muted-foreground">
        That link held nothing, so it's closed.
      </output>
    );
  }
  if (outcome.kind === "due") {
    return (
      <output className="block text-label text-pretty text-muted-foreground">
        Its Ghost Route payout arrives at about {LINK_DATE.format(outcome.at)}. Take it back after
        that.
      </output>
    );
  }
  const words = FAILURE_WORDS[outcome.facts.kind];
  return (
    <div className="flex flex-col gap-1">
      <MovedLine moved={outcome.moved} />
      <ProblemLine text={words.title} next={words.body} />
      {outcome.facts.maybeMoved ? <PlaceLink place="orders">See the order</PlaceLink> : null}
      {outcome.facts.signature ? (
        <a
          href={`${site}/tx/${outcome.facts.signature}`}
          target="_blank"
          rel="noreferrer"
          className="text-label underline underline-offset-2"
        >
          See it on chain
        </a>
      ) : null}
    </div>
  );
}
