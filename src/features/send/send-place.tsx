import { ArrowRightIcon } from "lucide-react";
import { useEffect, useId } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  AddressField,
  AmountField,
  Card,
  Done,
  ExternalLink,
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
import { AMOUNT_WORDS, feeWords } from "@/features/action/words";
import { mostWithFee, percentOf, plainAmount, readAmount } from "@/features/rings/amount-input";
import { formatAmount } from "@/features/rings/amounts";
import { WALLET_ASSETS, type Asset } from "@/features/rings/holdings";
import { useWallet } from "@/features/wallet/wallet-store";

import { SendWays } from "./send-ways";
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

const TITLE = "Send dark";
const BODY = "Pay a zSol address. The amount and the token stay hidden.";

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
  return (
    <div className="flex flex-col gap-4 p-4">
      <SendWays current="send" />
      <Heading title={TITLE} body={BODY} />
      {wallet.kind !== "open" || wallet.balances === null ? (
        <NotOpenYet what="Send" />
      ) : (
        <Stage send={send} site={site} signInWallet={signInWallet} />
      )}
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
  if (send.kind === "form") return <SendForm send={send} site={site} signInWallet={signInWallet} />;
  if (send.kind === "review")
    return <ReviewCard review={send.review} signInWallet={signInWallet} />;
  if (send.kind === "sending") return <Sending order={send.order} site={site} />;
  if (send.kind === "done") {
    const sent = send.review;
    return (
      <Done
        title="Sent. It's in their private balance."
        body={
          <>
            {formatAmount(sent.amount, sent.asset.decimals)} {sent.asset.symbol} to{" "}
            <span className="font-mono" title={sent.to} translate="no">
              {short(sent.to)}
            </span>
            . Your balance is up to date.
          </>
        }
        order={send.order}
        signature={send.signature}
        site={site}
        again="Send another"
        onAgain={another}
      />
    );
  }
  return (
    <Failed
      facts={send.facts}
      checking={send.checking}
      checked={send.checked}
      order={send.order}
      site={site}
      amount={send.review.amount}
      decimals={send.review.asset.decimals}
      onTryAgain={() => {
        edit();
        void review(signInWallet);
      }}
      onCheckAgain={() => void checkAgain()}
      onChange={edit}
      changeLabel="Change the send"
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
  const terms = useFeeTerms();
  const held = useHeld();
  const ids = { to: useId(), amount: useId(), toNote: useId(), amountNote: useId() };
  const asset = WALLET_ASSETS.find((each) => each.mint === draft.mint) ?? WALLET_ASSETS[0]!;
  const rate = percentOf(terms.sendFeeBps);
  const charged = terms.feeAssets.has(asset.mint);
  const least = charged ? (terms.sendFeeMinimums.get(asset.mint) ?? 0n) : 0n;
  const most = mostWithFee(held(asset.mint), (amount) => feeOn(asset.mint, amount, terms));
  const typed = readAmount(draft.amountText, asset.decimals);
  const fee = typed.ok ? feeOn(asset.mint, typed.amount, terms) : null;
  const { problem } = send;
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
        <AddressField
          id={ids.to}
          noteId={ids.toNote}
          label="To"
          placeholder="Their zSol address"
          value={draft.to}
          onChange={(to) => setDraft({ to })}
          invalid={toProblem !== null}
          note={toProblem ? <ToProblem problem={toProblem} site={site} /> : null}
        />
        <TokenPicker
          name="send-token"
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
            )
          }
        />
      </Card>
      {problem?.kind === "paused" ? <Paused why={problem.why} /> : null}
      {send.failure ? <PrepareFailure facts={send.failure} /> : null}
      <ReviewButton preparing={send.preparing} />
      <p className="px-1 text-label text-pretty text-muted-foreground">
        Paid from your private balance, to zSol addresses only.
      </p>
    </form>
  );
}

function ToProblem({ problem, site }: { readonly problem: FormProblem; readonly site: string }) {
  switch (problem.kind) {
    case "to-empty":
      return <ProblemLine text="Add the zSol address you're paying." />;
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
          next="To move money to a regular wallet, Unshield it instead."
          action={<UnshieldLink />}
        />
      );
    case "sign-in":
      return (
        <ProblemLine
          text="That's the wallet you sign in with."
          next="Send dark pays zSol private wallets. To move money to the wallet you sign in with, Unshield it: it arrives there in public."
          action={<UnshieldLink />}
        />
      );
    case "no-wallet":
      return (
        <ProblemLine
          text="This address has no private wallet yet, so it can't be paid privately."
          next="A Dark link reaches anyone: they claim it into a private wallet of their own."
          action={
            <ExternalLink href={`${site}/send#dark-link`}>Send a Dark link on zsol.cc</ExternalLink>
          }
        />
      );
    default:
      return null;
  }
}

function UnshieldLink() {
  return (
    <a
      href="#/unshield"
      className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
    >
      Unshield instead
    </a>
  );
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
          ? `It holds ${show(lack.held)} ${asset.symbol}. This needs ${show(lack.needed)} ${asset.symbol}: ${show(lack.amount)} plus zSol's ${least > 0n && lack.fee === least ? "least" : rate} fee of ${show(lack.fee)}.`
          : `It holds ${show(lack.held)} ${asset.symbol}. This needs ${show(lack.needed)} ${asset.symbol}.`
      }
      action={
        lack.most > 0n ? (
          <button
            type="button"
            onClick={() => setDraft({ amountText: plainAmount(lack.most, asset.decimals) })}
            className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
          >
            Send the most you can: {show(lack.most)} {asset.symbol}
          </button>
        ) : null
      }
    />
  );
}

function ReviewCard({
  review: sent,
  signInWallet,
}: {
  readonly review: Review;
  readonly signInWallet: string;
}) {
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
        <PublicAndHidden
          seen="Your zSol address paid theirs, and when. zSol's fee is one more payment in the same transaction."
          hidden="The amount and the token."
        />
      </Card>
      <ReviewActions
        builtAt={sent.builtAt}
        confirmLabel="Send dark"
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
