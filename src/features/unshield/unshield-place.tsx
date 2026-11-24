import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useEffect, useId } from "react";

import { placeHref } from "@/app/places";
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
  TokenPicker,
  useHeld,
} from "@/features/action/parts";
import { warmTerms } from "@/features/action/terms";
import { AMOUNT_WORDS } from "@/features/action/words";
import { plainAmount } from "@/features/rings/amount-input";
import { formatAmount } from "@/features/rings/amounts";
import { SOL, type Asset } from "@/features/rings/holdings";
import { UNSHIELD_COST_LAMPORTS } from "@/features/rings/unshield";
import { LookalikeLine, ReceiverHints } from "@/features/receivers/receiver-hints";
import { assetFor, useWallet } from "@/features/wallet/wallet-store";

import {
  another,
  back,
  checkAgain,
  confirm,
  edit,
  review,
  setDraft,
  useDraft,
  useUnshield,
  type FormProblem,
  type Review,
  type UnshieldState,
} from "./unshield-store";

export function UnshieldPlace({
  site,
  signInWallet,
}: {
  readonly site: string;
  readonly signInWallet: string;
}) {
  const wallet = useWallet();
  const state = useUnshield();
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
        title="Unshield"
        body="Move money from your private balance to any public address. It arrives in public: anyone can see the amount and the token."
      />
      {wallet.kind !== "open" || wallet.balances === null ? (
        <NotOpenYet what="Unshield" />
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
  readonly state: UnshieldState;
  readonly site: string;
  readonly signInWallet: string;
}) {
  if (state.kind === "form") {
    return <UnshieldForm state={state} signInWallet={signInWallet} />;
  }
  if (state.kind === "review") {
    return <ReviewCard review={state.review} signInWallet={signInWallet} />;
  }
  if (state.kind === "sending") return <Sending order={state.order} site={site} />;
  if (state.kind === "done") {
    const sent = state.review;
    return (
      <Done
        title="Unshielded. It's at their address, in public."
        body={
          <>
            {formatAmount(sent.amount, sent.asset.decimals)} {sent.asset.symbol} to{" "}
            <span className="font-mono" title={sent.to} translate="no">
              {short(sent.to)}
            </span>
            . Your private balance is up to date.
          </>
        }
        order={state.order}
        signature={state.signature}
        site={site}
        again="Unshield more"
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
      decimals={state.review.asset.decimals}
      onTryAgain={() => {
        edit();
        void review(signInWallet);
      }}
      onCheckAgain={() => void checkAgain()}
      onChange={edit}
      changeLabel="Change the Unshield"
      onDifferentReceiver={() => {
        edit();
        setDraft({ to: "" });
      }}
      onSmaller={(amountText) => {
        edit();
        setDraft({ amountText });
      }}
    />
  );
}

const positiveOr0 = (value: bigint) => (value > 0n ? value : 0n);

function UnshieldForm({
  state,
  signInWallet,
}: {
  readonly state: Extract<UnshieldState, { kind: "form" }>;
  readonly signInWallet: string;
}) {
  const draft = useDraft();
  const held = useHeld();
  const ids = { to: useId(), amount: useId(), toNote: useId(), amountNote: useId() };
  const asset = assetFor(draft.mint);
  const { problem } = state;
  const toProblem =
    problem && ["to-empty", "bad-address", "own"].includes(problem.kind) ? problem : null;
  const amountProblem =
    problem && ["amount", "short", "rent-short", "too-small-new"].includes(problem.kind)
      ? problem
      : null;
  const toSignIn = draft.to.trim() === signInWallet;
  const isSol = asset.mint === SOL.mint;
  // SOL out pays its network fee from the same SOL: Max leaves room for it.
  const most = isSol ? positiveOr0(held(asset.mint) - UNSHIELD_COST_LAMPORTS) : held(asset.mint);
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
          placeholder="Any Solana address"
          value={draft.to}
          onChange={(to) => setDraft({ to })}
          invalid={toProblem !== null}
          aside={
            toSignIn ? null : (
              <button
                type="button"
                onClick={() => setDraft({ to: signInWallet })}
                className={buttonVariants({ variant: "ghost", size: "xs" })}
              >
                My sign-in wallet
              </button>
            )
          }
          note={
            toProblem ? (
              <ToProblem problem={toProblem} />
            ) : toSignIn ? (
              <span className="text-warn">
                Anyone can see your zSol address paid the wallet you sign in with, which ties the
                two.
              </span>
            ) : (
              <ReceiverHints value={draft.to} kind="public" onPick={(to) => setDraft({ to })} />
            )
          }
        />
        <TokenPicker
          name="unshield-token"
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
                {isSol
                  ? `No fee of zSol's. Its network fee, about ${formatAmount(UNSHIELD_COST_LAMPORTS, 9)} SOL, comes from your private SOL.`
                  : "No fee of zSol's, and zSol pays the network fee. If the address has no account for this token yet, opening it and the network fee take a little of your private SOL."}
              </span>
            )
          }
        />
      </Card>
      {problem?.kind === "paused" ? <Paused why={problem.why} /> : null}
      {state.failure ? <PrepareFailure facts={state.failure} /> : null}
      <ReviewButton preparing={state.preparing} />
    </form>
  );
}

function ToProblem({ problem }: { readonly problem: FormProblem }) {
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
          next="Money unshielded there sits in public at your zSol address. Pick the wallet it should reach."
        />
      );
    default:
      return null;
  }
}

function AmountProblemLine({
  problem,
  asset,
}: {
  readonly problem: FormProblem;
  readonly asset: Asset;
}) {
  const show = (value: bigint, decimals = asset.decimals) => formatAmount(value, decimals);
  switch (problem.kind) {
    case "amount":
      return <ProblemLine text={AMOUNT_WORDS[problem.problem](asset.symbol, asset.decimals)} />;
    case "short": {
      const most = positiveOr0(problem.held - problem.fee);
      return (
        <ProblemLine
          text={
            problem.held === 0n
              ? `Your private balance holds no ${asset.symbol}.`
              : `Your private balance holds ${show(problem.held)} ${asset.symbol}.`
          }
          next={
            problem.fee > 0n
              ? `This needs ${show(problem.amount + problem.fee)} ${asset.symbol}: ${show(problem.amount)} plus its network fee of ${show(problem.fee)}.`
              : `This needs ${show(problem.amount)} ${asset.symbol}.`
          }
          action={
            most > 0n ? (
              <button
                type="button"
                onClick={() => setDraft({ amountText: plainAmount(most, asset.decimals) })}
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: "self-start",
                })}
              >
                {problem.fee > 0n ? "Unshield the most you can" : "Unshield all of it"}:{" "}
                {show(most)} {asset.symbol}
              </button>
            ) : null
          }
        />
      );
    }
    case "rent-short":
      return (
        <ProblemLine
          text={`Opening their ${asset.symbol} account and the network fee take ${show(problem.rent, 9)} SOL from your private balance.`}
          next={`It holds ${show(problem.held, 9)} SOL. Go dark with a little SOL first, or unshield to an address that already holds ${asset.symbol}.`}
        />
      );
    case "too-small-new":
      return (
        <ProblemLine
          text={`This address is empty, and Solana keeps an address only once it holds ${show(problem.least, 9)} SOL.`}
          next="Unshield at least that much to it."
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
              Unshield {show(problem.least, 9)} SOL
            </button>
          }
        />
      );
    default:
      return null;
  }
}

function ReviewCard({
  review: sent,
  signInWallet,
}: {
  readonly review: Review;
  readonly signInWallet: string;
}) {
  const show = `${formatAmount(sent.amount, sent.asset.decimals)} ${sent.asset.symbol}`;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-center gap-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-label text-muted-foreground">Your private balance</span>
            <span className="font-display text-xl font-semibold tabular-nums">{show}</span>
          </span>
          <ArrowRightIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
          <span className="flex min-w-0 flex-1 flex-col items-end">
            <span className="text-label text-muted-foreground">
              {sent.toSignIn ? "Your sign-in wallet" : "To"}
            </span>
            <span className="font-mono text-sm" title={sent.to} translate="no">
              {short(sent.to)}
            </span>
          </span>
        </div>
        <div className="flex flex-col gap-1 text-label text-pretty text-muted-foreground">
          <span>
            {sent.networkFee > 0n
              ? `No fee of zSol's. Its network fee, ${formatAmount(sent.networkFee, 9)} SOL, comes from your private balance in the same transaction.`
              : "No fee of zSol's, and zSol pays the network fee."}
          </span>
          {sent.rent > 0n ? (
            <span>
              Opening their {sent.asset.symbol} account takes {formatAmount(sent.rent, 9)} SOL from
              your private balance, in the same transaction.
            </span>
          ) : null}
          {sent.toSignIn ? (
            <span className="text-warn">
              Anyone can see your zSol address paid the wallet you sign in with, which ties the two.
            </span>
          ) : null}
        </div>
        <LookalikeLine to={sent.to} />
        <PublicAndHidden
          seen={`Your zSol address paid ${short(sent.to)} ${show}: both addresses, the amount and the token.`}
          hidden="What else your private balance holds."
        />
      </Card>
      <ReviewActions
        builtAt={sent.builtAt}
        confirmLabel="Unshield"
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
