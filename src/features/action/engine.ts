// A private action through zSol's fee wallet, from draft to outcome: the checks that need no
// network, the review built and kept while it can still land, the send with its order, and
// every outcome. Send dark, Pay many and Unshield each give it their own draft, checks and
// builder; the rest is the same for all of them.
import type { Transaction } from "@solana/kit";
import { useSyncExternalStore } from "react";

import { setBusy } from "@/features/lock/busy";
import type { OrderFacts, OrderKind } from "@/features/orders/order-model";
import { startOrder, type OrderHandle } from "@/features/orders/order-store";
import { lastBusy, lastUnauthorized } from "@/features/rings/client";
import { readAgain, readBack, spending } from "@/features/wallet/wallet-store";

import { failureOf, type FailureFacts } from "./outcomes";
import {
  checkLanded,
  submitSponsored,
  type Landed,
  type SendStep,
  type SponsorKind,
  type SponsorSetup,
} from "./sponsor";
import { staleTerms, termsFor } from "./terms";
import { FAILURE_WORDS } from "./words";

export type Spending = NonNullable<ReturnType<typeof spending>>;

/** What an action builds for review: its transaction, beside its own facts. */
export interface Prepared {
  readonly transaction: Transaction;
}

/** A review: what was built, from which draft, and when. */
export type Built<F extends Prepared> = F & {
  /** The draft it was built from, to reuse it when nothing changed. */
  readonly key: string;
  readonly builtAt: number;
};

export type Paused = { readonly kind: "paused"; readonly why: NonNullable<SponsorSetup["paused"]> };

export type ActionState<P, F extends Prepared, R = Built<F>> =
  | {
      readonly kind: "form";
      readonly preparing: boolean;
      readonly problem: P | Paused | null;
      /** Preparing failed: nothing moved. */
      readonly failure: FailureFacts | null;
    }
  | { readonly kind: "review"; readonly review: R }
  | {
      readonly kind: "sending";
      readonly review: R;
      readonly step: SendStep;
      readonly order: string;
    }
  | {
      readonly kind: "done";
      readonly review: R;
      readonly signature: string;
      readonly order: string;
    }
  | {
      readonly kind: "failed";
      readonly review: R;
      readonly order: string;
      readonly facts: FailureFacts;
      readonly checking: boolean;
      /** What the last "Check again" found. */
      readonly checked: Landed | null;
    };

export interface ActionContext {
  readonly open: Spending;
  /** The private wallet's own address. */
  readonly own: string;
  readonly signInWallet: string;
}

export interface ActionSpec<D, P, F extends Prepared> {
  readonly kind: OrderKind | ((review: Built<F>) => OrderKind);
  readonly empty: () => D;
  /** What a fresh action keeps from the last one (the token, for one). */
  readonly another: (draft: D) => D;
  /** The checks that need no network. */
  readonly check: (draft: D, context: ActionContext) => P | null;
  /** Names the draft: a review built from the same key is reused while it can still land. */
  readonly keyOf: (draft: D) => string;
  /** Builds it for review, or says why not. Nothing is signed. */
  readonly prepare: (
    draft: D,
    context: ActionContext & { readonly fees: SponsorSetup },
  ) => Promise<{ readonly problem: P } | { readonly review: F }>;
  /** What a failure the SDK reports about a receiver becomes, if anything. */
  readonly recipientProblem?: P;
  readonly facts: (review: Built<F>) => OrderFacts;
  /** How zSol takes it; a private action unless said. */
  readonly sponsorKind?: SponsorKind;
  /** Whether a pause of zSol's stops this action; every pause does unless said. */
  readonly stoppedBy?: (why: NonNullable<SponsorSetup["paused"]>, draft: D) => boolean;
  /** Runs once it landed and was read back. */
  readonly afterDone?: (review: Built<F>) => void;
  /** Sends it some other way than through zSol's fee wallet; resolves with its signature. */
  readonly submit?: (review: Built<F>, hooks: SubmitHooks) => Promise<string>;
}

export interface SubmitHooks {
  readonly onStep: (step: SendStep) => void;
  readonly onSigned: (signature: string) => void;
  readonly onSent: (signature: string) => void;
}

/** A built action is reused within this, while its blockhash is still good. */
const REVIEW_REUSE_MS = 45_000;

const ORDER_STEP: Record<SendStep, string> = {
  signing: "sign",
  sending: "send",
  confirming: "land",
  syncing: "read",
};

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

function contextOf(signInWallet: string): ActionContext | null {
  const open = spending();
  if (!open) return null;
  return { open, own: open.spender.keypair.shieldedAddress().solanaAddress(), signInWallet };
}

export function createAction<D, P, F extends Prepared>(spec: ActionSpec<D, P, F>) {
  type State = ActionState<P, F>;
  const formState = (
    problem: P | Paused | null = null,
    failure: FailureFacts | null = null,
  ): State => ({
    kind: "form",
    preparing: false,
    problem,
    failure,
  });

  let draft: D = spec.empty();
  let state: State = formState();
  let lastReview: Built<F> | null = null;
  let order: OrderHandle | null = null;
  const listeners = new Set<() => void>();

  const publish = () => {
    for (const listener of listeners) listener();
  };
  const setState = (next: State) => {
    const wasSending = state.kind === "sending";
    state = next;
    if (next.kind === "sending" || wasSending) setBusy(next.kind === "sending");
    publish();
  };

  function setDraft(change: Partial<D>) {
    draft = { ...draft, ...change };
    if (state.kind === "form" && (state.problem !== null || state.failure !== null)) {
      state = formState();
    }
    publish();
  }

  async function review(signInWallet: string): Promise<void> {
    if (state.kind !== "form" || state.preparing) return;
    const context = contextOf(signInWallet);
    if (!context) return;
    const problem = spec.check(draft, context);
    if (problem) {
      setState(formState(problem));
      return;
    }
    const key = spec.keyOf(draft);
    if (lastReview?.key === key && Date.now() - lastReview.builtAt < REVIEW_REUSE_MS) {
      setState({ kind: "review", review: lastReview });
      return;
    }
    setState({ kind: "form", preparing: true, problem: null, failure: null });
    const started = Date.now();
    const asked = draft;
    try {
      const fees = await termsFor(context.open.site);
      if (fees.paused && (spec.stoppedBy?.(fees.paused, asked) ?? true)) {
        setState(formState({ kind: "paused", why: fees.paused }));
        return;
      }
      const prepared = await spec.prepare(asked, { ...context, fees });
      if ("problem" in prepared) {
        setState(formState(prepared.problem));
        return;
      }
      const built: Built<F> = { ...prepared.review, key, builtAt: Date.now() };
      lastReview = built;
      setState({ kind: "review", review: built });
    } catch (error) {
      const facts = prepareFailure(error, started);
      setState(
        facts.kind === "recipient" && spec.recipientProblem !== undefined
          ? formState(spec.recipientProblem)
          : formState(null, facts),
      );
    }
  }

  function back() {
    if (state.kind === "review") setState(formState());
  }

  /** Signs and has zSol send it; the outcome stays on screen until the next one. */
  async function confirm(): Promise<void> {
    if (state.kind !== "review") return;
    const open = spending();
    if (!open) return;
    const { review: sent } = state;
    lastReview = null;
    const kind = typeof spec.kind === "function" ? spec.kind(sent) : spec.kind;
    const handle = startOrder(kind, spec.facts(sent), ["sign", "send", "land", "read"]);
    order = handle;
    setState({ kind: "sending", review: sent, step: "signing", order: handle.id });
    handle.at("sign");
    const onStep = (step: SendStep) => {
      handle.at(ORDER_STEP[step]);
      setState({ kind: "sending", review: sent, step, order: handle.id });
    };
    try {
      const signature = spec.submit
        ? await spec.submit(sent, { onStep, onSigned: handle.signed, onSent: handle.sent })
        : await submitSponsored({
            site: open.site,
            client: open.client,
            spender: open.spender,
            transaction: sent.transaction,
            ...(spec.sponsorKind ? { kind: spec.sponsorKind } : {}),
            onStep,
            onSigned: handle.signed,
            onSent: handle.sent,
            readBack,
          });
      handle.done();
      setState({ kind: "done", review: sent, signature, order: handle.id });
      spec.afterDone?.(sent);
    } catch (error) {
      const facts = failureOf(error, navigator.onLine);
      if (facts.kind === "landed-unsynced") handle.done();
      else if (facts.maybeMoved) handle.unsure();
      else handle.stop(FAILURE_WORDS[facts.kind]);
      // zSol found the fee short: its terms changed, so the next review reads them again.
      if (facts.kind === "stale") staleTerms();
      setState({
        kind: "failed",
        review: sent,
        facts,
        checking: false,
        checked: null,
        order: handle.id,
      });
      // Spent elsewhere, or failed on chain: what the balance holds now decides the next try.
      if (!facts.maybeMoved) void readAgain();
    }
  }

  /** Asks the chain again about one that may have landed. */
  async function checkAgain(): Promise<void> {
    if (state.kind !== "failed" || state.checking) return;
    const open = spending();
    const { review: sent, facts, order: id } = state;
    if (!open || !facts.signature) {
      await readAgain();
      return;
    }
    setState({ ...state, checking: true });
    const landed = await checkLanded(open.client, facts.signature, readBack);
    if (state.kind !== "failed") return;
    if (landed === "landed") {
      order?.done();
      setState({ kind: "done", review: sent, signature: facts.signature, order: id });
      spec.afterDone?.(sent);
    } else if (landed === "failed") {
      order?.stop(FAILURE_WORDS["failed-on-chain"]);
      setState({
        kind: "failed",
        review: sent,
        facts: { kind: "failed-on-chain", maybeMoved: false, signature: facts.signature },
        checking: false,
        checked: "failed",
        order: id,
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
  function edit() {
    if (state.kind === "failed" || state.kind === "review") setState(formState());
  }

  /** A fresh one, keeping what the action keeps. */
  function another() {
    draft = spec.another(draft);
    lastReview = null;
    setState(formState());
  }

  /** Forgets the draft and any outcome: the wallet closed. */
  function forget() {
    draft = spec.empty();
    lastReview = null;
    order = null;
    setState(formState());
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  const currentState = () => state;
  const currentDraft = () => draft;

  return {
    setDraft,
    review,
    back,
    confirm,
    checkAgain,
    edit,
    another,
    forget,
    useState: () => useSyncExternalStore(subscribe, currentState, currentState),
    useDraft: () => useSyncExternalStore(subscribe, currentDraft, currentDraft),
  };
}

export type Action<D, P, F extends Prepared> = ReturnType<typeof createAction<D, P, F>>;
