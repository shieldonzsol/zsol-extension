// Send dark from the panel: pay a zSol address from the private balance. The amount and the
// token stay hidden; zSol's 0.1% rides in the same transaction and zSol pays the network fee.
// The draft and any send in progress live here, so switching places never loses them.
import { buildMultiTransferTransaction, buildTransferTransaction } from "@heliuslabs/spr";
import { isWalletRegistered } from "@heliuslabs/spr/wallet";
import { address, isAddress, type Address, type Transaction } from "@solana/kit";
import { useSyncExternalStore } from "react";

import { feeAt, readAmount, type AmountProblem } from "@/features/rings/amount-input";
import { lastBusy, lastUnauthorized } from "@/features/rings/client";
import { heldIn, WALLET_ASSETS, type Asset } from "@/features/rings/holdings";
import { inWalletLane, readAgain, readBack, spending } from "@/features/wallet/wallet-store";

import { failureOf, shortfallOf, type FailureFacts, type Shortfall } from "./outcomes";
import {
  checkLanded,
  DEFAULT_SEND_FEE_BPS,
  sponsorSetup,
  submitSponsored,
  type Landed,
  type SendStep,
  type SponsorSetup,
} from "./sponsor";

export interface SendDraft {
  readonly to: string;
  readonly mint: string;
  readonly amountText: string;
}

export type FormProblem =
  | { readonly kind: "to-empty" }
  | { readonly kind: "bad-address" }
  | { readonly kind: "own" }
  | { readonly kind: "sign-in" }
  | { readonly kind: "no-wallet" }
  | { readonly kind: "amount"; readonly problem: AmountProblem }
  | { readonly kind: "short"; readonly short: Shortfall }
  | { readonly kind: "paused"; readonly why: NonNullable<SponsorSetup["paused"]> };

export interface Review {
  readonly to: Address;
  readonly asset: Asset;
  readonly amount: bigint;
  readonly fee: bigint;
  /** The rate the fee was worked out at, in basis points. */
  readonly feeBps: bigint;
  /** zSol's least fee on a send of this token, zero when it states none. */
  readonly feeLeast: bigint;
  readonly transaction: Transaction;
  /** The draft it was built from, to reuse it when nothing changed. */
  readonly key: string;
  readonly builtAt: number;
}

export type SendState =
  | {
      readonly kind: "form";
      readonly preparing: boolean;
      readonly problem: FormProblem | null;
      /** Preparing failed: nothing moved. */
      readonly failure: FailureFacts | null;
    }
  | { readonly kind: "review"; readonly review: Review }
  | { readonly kind: "sending"; readonly review: Review; readonly step: SendStep }
  | { readonly kind: "done"; readonly review: Review; readonly signature: string }
  | {
      readonly kind: "failed";
      readonly review: Review;
      readonly facts: FailureFacts;
      readonly checking: boolean;
      /** What the last "Check again" found. */
      readonly checked: Landed | null;
    };

type Spending = NonNullable<ReturnType<typeof spending>>;

/** A built send is reused within this, while its blockhash is still good. */
const REVIEW_REUSE_MS = 45_000;
const SETUP_FRESH_MS = 10_000;

const SOL_MINT = WALLET_ASSETS[0]?.mint ?? "11111111111111111111111111111111";

let draft: SendDraft = { to: "", mint: SOL_MINT, amountText: "" };
let state: SendState = { kind: "form", preparing: false, problem: null, failure: null };
let lastReview: Review | null = null;
let setup: { readonly value: SponsorSetup; readonly at: number; readonly site: string } | null =
  null;
const listeners = new Set<() => void>();

function publish() {
  for (const listener of listeners) listener();
}

function setState(next: SendState) {
  state = next;
  publish();
}

export function setDraft(change: Partial<SendDraft>) {
  draft = { ...draft, ...change };
  if (state.kind === "form" && (state.problem !== null || state.failure !== null)) {
    state = { kind: "form", preparing: false, problem: null, failure: null };
  }
  publish();
}

const assetOf = (mint: string): Asset =>
  WALLET_ASSETS.find((asset) => asset.mint === mint) ?? WALLET_ASSETS[0]!;

async function setupFor(site: string): Promise<SponsorSetup> {
  if (setup && setup.site === site && Date.now() - setup.at < SETUP_FRESH_MS) return setup.value;
  const value = await sponsorSetup(site);
  setup = { value, at: Date.now(), site };
  return value;
}

/** zSol's fee terms: which tokens pay it, and at what rate. */
export type FeeTerms = Pick<SponsorSetup, "feeAssets" | "sendFeeBps" | "sendFeeMinimums">;

// What the form shows until zSol's own terms are read.
const ASSUMED_TERMS: FeeTerms = {
  feeAssets: new Set(WALLET_ASSETS.map((each) => each.mint)),
  sendFeeBps: DEFAULT_SEND_FEE_BPS,
  sendFeeMinimums: new Map(),
};

const currentTerms = (): FeeTerms => setup?.value ?? ASSUMED_TERMS;

/** zSol's fee on a send of `amount` of `mint`: its rate on the tokens it charges, nothing on others. */
export function feeOn(mint: string, amount: bigint, terms: FeeTerms = currentTerms()): bigint {
  return terms.feeAssets.has(mint)
    ? feeAt(amount, terms.sendFeeBps, terms.sendFeeMinimums.get(mint) ?? 0n)
    : 0n;
}

/** Reads zSol's fee terms ahead of the first review, so the form shows them as they are. */
export async function warmFees(site: string): Promise<void> {
  try {
    await setupFor(site);
    publish();
  } catch {
    // The review reads them again and says what went wrong.
  }
}

/** The checks that need no network: the address and the amount. */
export function draftProblem(
  input: SendDraft,
  own: string | null,
  signInWallet: string,
): FormProblem | null {
  const to = input.to.trim();
  if (to === "") return { kind: "to-empty" };
  if (!isAddress(to)) return { kind: "bad-address" };
  if (to === own) return { kind: "own" };
  if (to === signInWallet) return { kind: "sign-in" };
  const read = readAmount(input.amountText, assetOf(input.mint).decimals);
  return read.ok ? null : { kind: "amount", problem: read.problem };
}

/** Builds the send for review: nothing is signed yet. */
export async function review(signInWallet: string): Promise<void> {
  if (state.kind !== "form" || state.preparing) return;
  const open = spending();
  if (!open) return;
  const own = open.spender.keypair.shieldedAddress().solanaAddress();
  const problem = draftProblem(draft, own, signInWallet);
  if (problem) {
    setState({ kind: "form", preparing: false, problem, failure: null });
    return;
  }
  const asset = assetOf(draft.mint);
  const read = readAmount(draft.amountText, asset.decimals);
  if (!read.ok) return;
  const to = address(draft.to.trim());
  const key = `${to}|${asset.mint}|${String(read.amount)}`;
  if (lastReview?.key === key && Date.now() - lastReview.builtAt < REVIEW_REUSE_MS) {
    setState({ kind: "review", review: lastReview });
    return;
  }
  setState({ kind: "form", preparing: true, problem: null, failure: null });
  const started = Date.now();
  try {
    const fees = await setupFor(open.site);
    if (fees.paused) {
      setState({
        kind: "form",
        preparing: false,
        problem: { kind: "paused", why: fees.paused },
        failure: null,
      });
      return;
    }
    const short = shortfallOf({
      held: heldIn(open.spender.wallet, asset.mint),
      amount: read.amount,
      feeOf: (amount) => feeOn(asset.mint, amount, fees),
    });
    if (short) {
      setState({
        kind: "form",
        preparing: false,
        problem: { kind: "short", short },
        failure: null,
      });
      return;
    }
    if (!(await isWalletRegistered({ rpc: open.client, owner: to }))) {
      setState({ kind: "form", preparing: false, problem: { kind: "no-wallet" }, failure: null });
      return;
    }
    const fee = feeOn(asset.mint, read.amount, fees);
    const transaction = await inWalletLane(() => build(open, fees, to, asset, read.amount, fee));
    lastReview = {
      to,
      asset,
      amount: read.amount,
      fee,
      feeBps: fees.sendFeeBps,
      feeLeast: fees.feeAssets.has(asset.mint) ? (fees.sendFeeMinimums.get(asset.mint) ?? 0n) : 0n,
      transaction,
      key,
      builtAt: Date.now(),
    };
    setState({ kind: "review", review: lastReview });
  } catch (error) {
    const facts = prepareFailure(error, started);
    setState(
      facts.kind === "recipient"
        ? { kind: "form", preparing: false, problem: { kind: "no-wallet" }, failure: null }
        : { kind: "form", preparing: false, problem: null, failure: facts },
    );
  }
}

/** Why preparing failed: zSol's own answers while it was built say more than the SDK's error. */
function prepareFailure(error: unknown, started: number): FailureFacts {
  if (navigator.onLine && lastUnauthorized() >= started) {
    return { kind: "signed-out", maybeMoved: false };
  }
  const busy = lastBusy();
  if (navigator.onLine && busy.at >= started) {
    return {
      kind: "busy",
      maybeMoved: false,
      ...(busy.retryAfter > 0 ? { retryAfter: Math.ceil(busy.retryAfter) } : {}),
    };
  }
  return failureOf(error, navigator.onLine);
}

/** One payment to `to`, and zSol's fee as one more hidden output to its treasury. */
function build(
  open: Spending,
  fees: SponsorSetup,
  to: Address,
  asset: Asset,
  amount: bigint,
  fee: bigint,
): Promise<Transaction> {
  const common = {
    client: open.client,
    wallet: open.spender.wallet,
    keys: open.spender.keys,
    feePayer: fees.feePayer,
    asset: address(asset.mint),
  };
  return fee > 0n
    ? buildMultiTransferTransaction({
        ...common,
        payments: [
          { recipient: to, amount },
          { recipient: fees.treasury, amount: fee },
        ],
      })
    : buildTransferTransaction({ ...common, recipient: to, amount });
}

export function back() {
  if (state.kind === "review") {
    setState({ kind: "form", preparing: false, problem: null, failure: null });
  }
}

/** Signs and has zSol send it; the outcome stays on screen until the next send. */
export async function confirm(): Promise<void> {
  if (state.kind !== "review") return;
  const open = spending();
  if (!open) return;
  const { review: sent } = state;
  lastReview = null;
  setState({ kind: "sending", review: sent, step: "signing" });
  try {
    const signature = await submitSponsored({
      site: open.site,
      client: open.client,
      spender: open.spender,
      transaction: sent.transaction,
      onStep: (step) => setState({ kind: "sending", review: sent, step }),
      readBack,
    });
    setState({ kind: "done", review: sent, signature });
  } catch (error) {
    const facts = failureOf(error, navigator.onLine);
    // zSol found the fee short: its terms changed, so the next review reads them again.
    if (facts.kind === "stale") setup = null;
    setState({ kind: "failed", review: sent, facts, checking: false, checked: null });
    // Spent elsewhere, or failed on chain: what the balance holds now decides the next try.
    if (!facts.maybeMoved) void readAgain();
  }
}

/** Asks the chain again about a send that may have landed. */
export async function checkAgain(): Promise<void> {
  if (state.kind !== "failed" || state.checking) return;
  const open = spending();
  const { review: sent, facts } = state;
  if (!open || !facts.signature) {
    await readAgain();
    return;
  }
  setState({ ...state, checking: true });
  const landed = await checkLanded(open.client, facts.signature, readBack);
  if (state.kind !== "failed") return;
  if (landed === "landed") {
    setState({ kind: "done", review: sent, signature: facts.signature });
  } else if (landed === "failed") {
    setState({
      kind: "failed",
      review: sent,
      facts: { kind: "failed-on-chain", maybeMoved: false, signature: facts.signature },
      checking: false,
      checked: "failed",
    });
    void readAgain();
  } else {
    setState({
      ...state,
      checking: false,
      checked: landed,
      facts: landed === "unsynced" ? { ...facts, kind: "landed-unsynced" } : facts,
    });
  }
}

/** Back to the form with the same draft: to try again, or change it. */
export function edit() {
  if (state.kind === "failed" || state.kind === "review") {
    setState({ kind: "form", preparing: false, problem: null, failure: null });
  }
}

/** A fresh send, keeping the token. */
export function another() {
  draft = { to: "", mint: draft.mint, amountText: "" };
  lastReview = null;
  setState({ kind: "form", preparing: false, problem: null, failure: null });
}

/** Forgets the draft and any outcome: the wallet closed. */
export function forgetSend() {
  draft = { to: "", mint: SOL_MINT, amountText: "" };
  lastReview = null;
  setup = null;
  setState({ kind: "form", preparing: false, problem: null, failure: null });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const currentState = () => state;
const currentDraft = () => draft;

export function useSend(): SendState {
  return useSyncExternalStore(subscribe, currentState, currentState);
}

export function useFeeTerms(): FeeTerms {
  return useSyncExternalStore(subscribe, currentTerms, currentTerms);
}

export function useDraft(): SendDraft {
  return useSyncExternalStore(subscribe, currentDraft, currentDraft);
}

/** A send is being signed or sent: locking or disconnecting waits for it. */
export function useSendBusy(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.kind === "sending",
    () => state.kind === "sending",
  );
}
