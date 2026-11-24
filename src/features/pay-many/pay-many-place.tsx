import { UploadIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  Done,
  ExternalLink,
  Failed,
  NotOpenYet,
  Paused,
  PrepareFailure,
  ProblemLine,
  PublicAndHidden,
  ReviewActions,
  ReviewButton,
  Sending,
  short,
  TokenPicker,
} from "@/features/action/parts";
import { feeOn, useFeeTerms, warmTerms } from "@/features/action/terms";
import { feeWords } from "@/features/action/words";
import { percentOf } from "@/features/rings/amount-input";
import { formatAmount } from "@/features/rings/amounts";
import { WALLET_ASSETS, type Asset } from "@/features/rings/holdings";
import { SendWays } from "@/features/send/send-ways";
import { useWallet } from "@/features/wallet/wallet-store";

import {
  MAX_PAYEES,
  parsePayList,
  withoutAddresses,
  withoutLine,
  type LineProblem,
} from "./pay-list";
import {
  another,
  back,
  checkAgain,
  confirm,
  edit,
  payFirstNow,
  review,
  setDraft,
  useDraft,
  usePayMany,
  type FormProblem,
  type PayManyState,
  type Review,
} from "./pay-many-store";

/** A list of 14 payments is small: anything much larger isn't one. */
const MAX_FILE_BYTES = 64 * 1024;

const LINE_WORDS: Record<LineProblem, (line: number) => string> = {
  format: (line) => `Line ${String(line)} needs an address and an amount, and nothing else.`,
  address: (line) => `Line ${String(line)} isn't a Solana address.`,
  amount: (line) => `Line ${String(line)} needs an amount, like 0.5.`,
  twice: (line) => `Line ${String(line)} pays an address already in the list.`,
  own: (line) => `Line ${String(line)} is your own zSol address.`,
  comma: (line) => `Line ${String(line)} uses a comma for decimals. Write it with a dot, like 0.5.`,
};

const people = (count: number) => (count === 1 ? "1 person" : `${String(count)} people`);

export function PayManyPlace({
  site,
  signInWallet,
}: {
  readonly site: string;
  readonly signInWallet: string;
}) {
  const wallet = useWallet();
  const state = usePayMany();
  useEffect(() => {
    void warmTerms(site);
  }, [site]);
  return (
    <div className="flex flex-col gap-4 p-4">
      <SendWays current="pay-many" />
      <div className="flex flex-col gap-1">
        <h1 className="headline text-2xl">Pay many</h1>
        <p className="text-sm text-pretty text-muted-foreground">
          Pay up to {MAX_PAYEES} zSol addresses at once. One a line: address, then amount.
        </p>
      </div>
      {wallet.kind !== "open" || wallet.balances === null ? (
        <NotOpenYet what="Pay many" />
      ) : (
        <Stage state={state} site={site} signInWallet={signInWallet} own={wallet.address} />
      )}
    </div>
  );
}

function Stage({
  state,
  site,
  signInWallet,
  own,
}: {
  readonly state: PayManyState;
  readonly site: string;
  readonly signInWallet: string;
  readonly own: string | null;
}) {
  const draft = useDraft();
  if (state.kind === "form") {
    return <PayManyForm state={state} site={site} signInWallet={signInWallet} own={own} />;
  }
  if (state.kind === "review")
    return <ReviewCard review={state.review} signInWallet={signInWallet} />;
  if (state.kind === "sending") return <Sending order={state.order} site={site} />;
  if (state.kind === "done") {
    const paid = state.review;
    const leftCount = draft.rest.split(/\r?\n/).filter((line) => line.trim() !== "").length;
    return (
      <Done
        title={
          paid.rows.length === 1
            ? "Paid. It's in their private balance."
            : `Paid. It's in their ${String(paid.rows.length)} private balances.`
        }
        body={
          <>
            {formatAmount(paid.total, paid.asset.decimals)} {paid.asset.symbol} to{" "}
            {people(paid.rows.length)}. Your balance is up to date.
            {leftCount > 0
              ? ` ${leftCount === 1 ? "1 payment is" : `${String(leftCount)} payments are`} left to pay.`
              : ""}
          </>
        }
        order={state.order}
        signature={state.signature}
        site={site}
        again={leftCount > 0 ? "Pay the rest" : "Pay another list"}
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
      amount={state.review.total}
      decimals={state.review.asset.decimals}
      onTryAgain={() => {
        edit();
        void review(signInWallet);
      }}
      onCheckAgain={() => void checkAgain()}
      onChange={edit}
      changeLabel="Edit the list"
    />
  );
}

function PayManyForm({
  state,
  site,
  signInWallet,
  own,
}: {
  readonly state: Extract<PayManyState, { kind: "form" }>;
  readonly site: string;
  readonly signInWallet: string;
  readonly own: string | null;
}) {
  const draft = useDraft();
  const terms = useFeeTerms();
  const ids = { list: useId(), note: useId() };
  const file = useRef<HTMLInputElement>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const asset = WALLET_ASSETS.find((each) => each.mint === draft.mint) ?? WALLET_ASSETS[0]!;
  const parsed = parsePayList(draft.list, asset.decimals, own ?? "");
  const total = parsed.ok ? parsed.rows.reduce((sum, row) => sum + row.amount, 0n) : null;
  const fee = total === null ? null : feeOn(asset.mint, total, terms);
  const charged = terms.feeAssets.has(asset.mint);
  const least = charged ? (terms.sendFeeMinimums.get(asset.mint) ?? 0n) : 0n;
  const { problem } = state;

  const read = (picked: File | undefined) => {
    setFileProblem(null);
    if (!picked) return;
    if (picked.size > MAX_FILE_BYTES) {
      setFileProblem(
        "That file is too big for a list of payments. Check it's the right file, or paste the list.",
      );
      return;
    }
    picked.text().then(
      (text) => setDraft({ list: text }),
      () => setFileProblem("That file couldn't be read. Paste the list instead."),
    );
  };

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
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={ids.list} className="text-label font-medium text-muted-foreground">
              Payees
            </label>
            <button
              type="button"
              onClick={() => file.current?.click()}
              className={buttonVariants({ variant: "ghost", size: "xs" })}
            >
              <UploadIcon data-icon="inline-start" strokeWidth={1.75} />
              Upload a CSV
            </button>
            <input
              ref={file}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                read(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
          <textarea
            id={ids.list}
            value={draft.list}
            onChange={(event) => setDraft({ list: event.target.value })}
            placeholder="Their zSol address, 0.5"
            rows={6}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={problem !== null && problem.kind !== "paused" && problem.kind !== "short"}
            aria-describedby={ids.note}
            className="min-h-32 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-label leading-5 outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
          />
          <div id={ids.note} className="text-label text-pretty">
            {fileProblem ? (
              <ProblemLine text={fileProblem} />
            ) : problem && problem.kind !== "paused" ? (
              <ListProblem problem={problem} asset={asset} site={site} />
            ) : parsed.ok && total !== null ? (
              <span className="text-muted-foreground">
                {people(parsed.rows.length)}, {formatAmount(total, asset.decimals)} {asset.symbol}{" "}
                in all.
              </span>
            ) : null}
          </div>
        </div>
        <TokenPicker
          name="pay-many-token"
          picked={asset}
          onPick={(picked) => setDraft({ mint: picked.mint })}
        />
        <p className="text-label text-pretty text-muted-foreground">
          {feeWords({
            rate: percentOf(terms.sendFeeBps),
            least: least > 0n ? formatAmount(least, asset.decimals) : null,
            fee: fee !== null && fee > 0n ? formatAmount(fee, asset.decimals) : null,
            symbol: asset.symbol,
            charged,
          })}
        </p>
      </Card>
      {problem?.kind === "paused" ? <Paused why={problem.why} /> : null}
      {state.failure ? <PrepareFailure facts={state.failure} /> : null}
      <ReviewButton preparing={state.preparing} />
    </form>
  );
}

function button(label: string, onClick: () => void) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
    >
      {label}
    </button>
  );
}

function ListProblem({
  problem,
  asset,
  site,
}: {
  readonly problem: Exclude<FormProblem, { kind: "paused" }>;
  readonly asset: Asset;
  readonly site: string;
}) {
  const draft = useDraft();
  switch (problem.kind) {
    case "empty":
      return <ProblemLine text="Add at least one payment: an address, then an amount." />;
    case "too-many":
      return (
        <ProblemLine
          text={`That's ${String(problem.count)} payments. One transaction pays up to ${String(MAX_PAYEES)}.`}
          next={`Pay the first ${String(MAX_PAYEES)} now; the other ${String(problem.count - MAX_PAYEES)} wait here for after.`}
          action={button(`Pay the first ${String(MAX_PAYEES)} now`, () => payFirstNow(draft))}
        />
      );
    case "line":
      return (
        <ProblemLine
          text={LINE_WORDS[problem.problem](problem.line)}
          {...(problem.also.length > 0
            ? {
                next:
                  problem.also.length === 1
                    ? `Line ${String(problem.also[0])} needs fixing too.`
                    : `Lines ${problem.also.join(", ")} need fixing too.`,
              }
            : {})}
          action={button(`Remove line ${String(problem.line)}`, () =>
            setDraft({ list: withoutLine(draft.list, problem.line) }),
          )}
        />
      );
    case "short": {
      const lack = problem.short;
      const show = (value: bigint) => formatAmount(value, asset.decimals);
      return (
        <ProblemLine
          text={`Your private balance is ${show(lack.short)} ${asset.symbol} short.`}
          next={`It holds ${show(lack.held)} ${asset.symbol}. The list and zSol's fee need ${show(lack.needed)} ${asset.symbol}.`}
        />
      );
    }
    case "no-wallet":
      return (
        <ProblemLine
          text={`${
            problem.addresses.length === 1 ? "This address has" : "These addresses have"
          } no private wallet yet, so ${problem.addresses.length === 1 ? "it" : "they"} can't be paid privately: ${problem.addresses.map(short).join(", ")}.`}
          next={
            problem.addresses.length === 1
              ? "Send it a Dark link instead, on zsol.cc."
              : "Send them Dark links instead, on zsol.cc."
          }
          action={
            <span className="flex flex-wrap gap-2">
              {button(
                problem.addresses.length === 1
                  ? "Remove it from the list"
                  : "Remove them from the list",
                () => setDraft({ list: withoutAddresses(draft.list, problem.addresses) }),
              )}
              <ExternalLink href={`${site}/send#dark-link`}>Make a Dark link</ExternalLink>
            </span>
          }
        />
      );
  }
  return null;
}

function ReviewCard({
  review: paid,
  signInWallet,
}: {
  readonly review: Review;
  readonly signInWallet: string;
}) {
  const show = (value: bigint) =>
    `${formatAmount(value, paid.asset.decimals)} ${paid.asset.symbol}`;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <ul aria-label="Who gets how much" className="flex flex-col divide-y divide-border/70">
          {paid.rows.map((row) => (
            <li
              key={row.to}
              className="flex items-center justify-between gap-3 py-1.5 first:pt-0 last:pb-0"
            >
              <span className="font-mono text-label" title={row.to} translate="no">
                {short(row.to)}
              </span>
              <span className="text-sm font-medium tabular-nums">{show(row.amount)}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between gap-3 border-t border-border/70 pt-3">
          <span className="text-label text-muted-foreground">In all</span>
          <span className="font-display text-lg font-semibold tabular-nums">
            {show(paid.total)}
          </span>
        </div>
        <p className="text-label text-pretty text-muted-foreground">
          {feeWords({
            rate: percentOf(paid.feeBps),
            least: paid.feeLeast > 0n ? formatAmount(paid.feeLeast, paid.asset.decimals) : null,
            fee: formatAmount(paid.fee, paid.asset.decimals),
            symbol: paid.asset.symbol,
            charged: paid.fee > 0n,
          })}
        </p>
        <PublicAndHidden
          seen={`Your zSol address paid ${paid.rows.length === 1 ? "this address" : `these ${String(paid.rows.length)} addresses`}, and when. zSol's fee is one more payment in the same transaction.`}
          hidden="Who got how much, and the token."
        />
      </Card>
      <ReviewActions
        builtAt={paid.builtAt}
        confirmLabel={`Pay ${people(paid.rows.length)}`}
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
