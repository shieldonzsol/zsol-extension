// The trader's Dark links, and moving a link's money into the private balance: taking back one
// of their own, or claiming one someone sent them. One move runs at a time; what it did stays on
// screen until the next.
import { useSyncExternalStore } from "react";

import { failureOf, type FailureFacts } from "@/features/action/outcomes";
import { fundLink } from "@/features/ghost/ghost-pay-store";
import { termsFor } from "@/features/action/terms";
import { FAILURE_WORDS } from "@/features/action/words";
import { startOrder, type OrderHandle } from "@/features/orders/order-store";
import type { SprClient } from "@/features/rings/client";
import { formatAmount } from "@/features/rings/amounts";
import { WALLET_ASSETS, type Asset } from "@/features/rings/holdings";
import { privateKeypair } from "@/features/rings/keys";
import { codeInText, darkLinkCode, keyOfCode, linkUrl } from "@/features/rings/links";
import { SiteError, type SiteFailure } from "@/features/rings/site-api";
import { tokenInfo } from "@/features/rings/token-info";
import { linkKey, readAgain, readBack, spending } from "@/features/wallet/wallet-store";

import { claimAll, PartlyClaimed, type ClaimProgress } from "./claim-run";
import { closeLink, listLink, nextIndex, readLinks, type LinkRow } from "./link-api";
import { landedAt, openLinkWallet, privateHoldings, withLanded, type Holding } from "./link-wallet";

/** A holding with its token named, as people read it. */
export interface Shown {
  readonly asset: Asset;
  readonly amount: bigint;
}

export type ListView =
  | { readonly kind: "reading"; readonly rows: readonly LinkRow[] | null }
  | { readonly kind: "ready"; readonly rows: readonly LinkRow[] }
  | {
      readonly kind: "failed";
      readonly failure: SiteFailure | "failed";
      readonly rows: readonly LinkRow[] | null;
    };

/** What happened to a move, once it ran. */
type Outcome =
  | { readonly kind: "moved"; readonly moved: readonly Shown[] }
  /** It held nothing: an own link is closed then. */
  | { readonly kind: "empty" }
  /** It held nothing yet: its Ghost Route payout lands at `at`. */
  | { readonly kind: "due"; readonly at: number }
  | {
      readonly kind: "failed";
      readonly facts: FailureFacts;
      /** What moved before it stopped. */
      readonly moved: readonly Shown[];
    };

export type BackView =
  | { readonly kind: "reading"; readonly index: number }
  | { readonly kind: "sure"; readonly index: number; readonly holdings: readonly Shown[] }
  | { readonly kind: "unread"; readonly index: number }
  | {
      readonly kind: "moving";
      readonly index: number;
      readonly progress: ClaimProgress | null;
      readonly order: string;
    }
  | { readonly kind: "after"; readonly index: number; readonly outcome: Outcome };

export type ClaimView =
  | { readonly kind: "idle" }
  | { readonly kind: "broken" }
  | { readonly kind: "reading"; readonly code: string }
  | { readonly kind: "unread"; readonly code: string }
  | { readonly kind: "empty"; readonly code: string }
  | { readonly kind: "ready"; readonly code: string; readonly holdings: readonly Shown[] }
  | {
      readonly kind: "moving";
      readonly code: string;
      readonly holdings: readonly Shown[];
      readonly progress: ClaimProgress | null;
      readonly order: string;
    }
  | {
      readonly kind: "after";
      readonly code: string;
      readonly holdings: readonly Shown[];
      readonly outcome: Outcome;
      readonly order: string | null;
    };

interface State {
  readonly list: ListView;
  readonly back: BackView | null;
  readonly claim: ClaimView;
}

let state: State = { list: { kind: "reading", rows: null }, back: null, claim: { kind: "idle" } };
const listeners = new Set<() => void>();
let turn = 0;

function set(change: Partial<State>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

/** Changes the state only while the wallet that started the work is still open. */
function setIn(at: number, change: Partial<State>) {
  if (at === turn) set(change);
}

const rowsOf = (list: ListView) => list.rows;

/** Reads the trader's links again. */
export async function refreshLinks(): Promise<void> {
  const open = spending();
  if (!open) return;
  const at = turn;
  set({ list: { kind: "reading", rows: rowsOf(state.list) } });
  try {
    const rows = await readLinks(open.site);
    if (at === turn) set({ list: { kind: "ready", rows } });
  } catch (error) {
    if (at !== turn) return;
    set({
      list: {
        kind: "failed",
        failure: error instanceof SiteError ? error.failure : "failed",
        rows: rowsOf(state.list),
      },
    });
  }
}

const shortOf = (value: string) => `${value.slice(0, 4)}…${value.slice(-4)}`;

async function named(
  site: string,
  client: Pick<SprClient, "solanaRpc">,
  holdings: readonly Holding[],
): Promise<Shown[]> {
  return Promise.all(
    holdings.map(async (holding) => ({
      amount: holding.amount,
      asset: WALLET_ASSETS.find((each) => each.mint === holding.mint) ??
        (await tokenInfo(site, client, holding.mint).catch(() => null)) ?? {
          mint: holding.mint,
          symbol: shortOf(holding.mint),
          decimals: 0,
          places: 0,
        },
    })),
  );
}

/** "0.5 SOL and 12 USDC". */
export function amountsText(shown: readonly Shown[]): string {
  const each = shown.map(
    (one) => `${formatAmount(one.amount, one.asset.decimals)} ${one.asset.symbol}`,
  );
  return each.length <= 1
    ? (each[0] ?? "")
    : `${each.slice(0, -1).join(", ")} and ${each.at(-1) ?? ""}`;
}

/** What a link holds, read with its own key. */
async function holdingsOf(key: Uint8Array): Promise<Shown[]> {
  const open = spending();
  if (!open) throw new Error("The wallet closed.");
  const linkWallet = await openLinkWallet(open.client, key);
  const landed = await landedAt(open.client, linkWallet);
  return named(open.site, open.client, withLanded(privateHoldings(linkWallet), landed));
}

const PART_MOVED = {
  title: "Part of it moved, then the rest stopped.",
  body: "What moved is in your private balance. Moving the rest takes only what is left.",
};

const isMoving = () => state.back?.kind === "moving" || state.claim.kind === "moving";

/** Moves everything the link holds into the private balance, as an order. */
async function move(
  key: Uint8Array,
  kind: "link-back" | "link-claim",
  holdings: readonly Shown[],
  onStart: (order: string) => void,
  onProgress: (progress: ClaimProgress) => void,
): Promise<Outcome> {
  const open = spending();
  if (!open) throw new Error("The wallet closed.");
  // The link signs every move: an order the panel left running is found on chain by its address.
  const signer = (await privateKeypair(key)).shieldedAddress().solanaAddress();
  const order: OrderHandle = startOrder(
    kind,
    holdings.length > 0 ? { amount: amountsText(holdings) } : {},
    ["claim"],
    signer,
  );
  onStart(order.id);
  order.at("claim");
  try {
    const fees = await termsFor(open.site);
    if (fees.paused) {
      order.stop(FAILURE_WORDS.paused);
      return { kind: "failed", facts: { kind: "paused", maybeMoved: false }, moved: [] };
    }
    const moved = await claimAll({
      site: open.site,
      client: open.client,
      own: open.spender,
      feePayer: fees.feePayer,
      key,
      readBack,
      onProgress,
      onSigned: order.signed,
      onSent: order.sent,
    });
    order.done();
    if (moved.length === 0) return { kind: "empty" };
    return { kind: "moved", moved: await named(open.site, open.client, moved) };
  } catch (error) {
    const cause = error instanceof PartlyClaimed ? error.cause : error;
    const facts = failureOf(cause, navigator.onLine);
    if (facts.maybeMoved) order.unsure();
    else if (error instanceof PartlyClaimed) order.stop(PART_MOVED);
    else order.stop(FAILURE_WORDS[facts.kind]);
    const moved =
      error instanceof PartlyClaimed ? await named(open.site, open.client, error.moved) : [];
    if (!facts.maybeMoved) void readAgain();
    return { kind: "failed", facts, moved };
  }
}

/** Reads what one of the trader's links holds, to ask before taking it back. */
export async function askTakeBack(index: number): Promise<void> {
  const at = turn;
  if (isMoving()) return;
  setIn(at, { back: { kind: "reading", index } });
  const key = await linkKey(index);
  if (!key) return;
  try {
    const holdings = await holdingsOf(key);
    if (state.back?.index !== index) return;
    if (holdings.length > 0) {
      setIn(at, { back: { kind: "sure", index, holdings } });
      return;
    }
    // Nothing in it: closed now, unless its Ghost Route payout is still on its way.
    const open = spending();
    const closed = open ? await closeLink(open.site, index) : { kind: "closed" as const };
    setIn(at, {
      back: {
        kind: "after",
        index,
        outcome: closed.kind === "due" ? { kind: "due", at: closed.at } : { kind: "empty" },
      },
    });
    void refreshLinks();
  } catch {
    if (state.back?.index === index) setIn(at, { back: { kind: "unread", index } });
  } finally {
    key.fill(0);
  }
}

export async function takeBack(index: number): Promise<void> {
  const at = turn;
  const asked = state.back;
  if (isMoving() || asked?.kind !== "sure" || asked.index !== index) return;
  const key = await linkKey(index);
  if (!key) return;
  let order = "";
  try {
    const outcome = await move(
      key,
      "link-back",
      asked.holdings,
      (id) => {
        order = id;
        setIn(at, { back: { kind: "moving", index, progress: null, order: id } });
      },
      (progress) => setIn(at, { back: { kind: "moving", index, progress, order } }),
    );
    if (outcome.kind === "empty") {
      const open = spending();
      const closed = open ? await closeLink(open.site, index).catch(() => null) : null;
      setIn(at, {
        back: {
          kind: "after",
          index,
          outcome: closed?.kind === "due" ? { kind: "due", at: closed.at } : outcome,
        },
      });
    } else {
      setIn(at, { back: { kind: "after", index, outcome } });
    }
  } finally {
    key.fill(0);
    void refreshLinks();
  }
}

export function keepOpen(): void {
  if (state.back?.kind !== "moving") set({ back: null });
}

/** Opens a pasted link: what it holds, read with its own key, before anything moves. */
export async function openClaim(text: string): Promise<void> {
  const at = turn;
  if (isMoving()) return;
  const code = codeInText(text);
  if (!code) {
    setIn(at, { claim: { kind: "broken" } });
    return;
  }
  const key = keyOfCode(code);
  if (!key) {
    setIn(at, { claim: { kind: "broken" } });
    return;
  }
  setIn(at, { claim: { kind: "reading", code } });
  try {
    const holdings = await holdingsOf(key);
    if (state.claim.kind !== "reading" || state.claim.code !== code) return;
    setIn(at, {
      claim: holdings.length > 0 ? { kind: "ready", code, holdings } : { kind: "empty", code },
    });
  } catch {
    if (state.claim.kind === "reading" && state.claim.code === code) {
      setIn(at, { claim: { kind: "unread", code } });
    }
  } finally {
    key.fill(0);
  }
}

export async function claimIt(): Promise<void> {
  const at = turn;
  const asked = state.claim;
  if (isMoving() || (asked.kind !== "ready" && asked.kind !== "after")) return;
  const key = keyOfCode(asked.code);
  if (!key) return;
  const { code, holdings } = asked;
  let order = "";
  try {
    const outcome = await move(
      key,
      "link-claim",
      holdings,
      (id) => {
        order = id;
        setIn(at, { claim: { kind: "moving", code, holdings, progress: null, order: id } });
      },
      (progress) => setIn(at, { claim: { kind: "moving", code, holdings, progress, order } }),
    );
    setIn(at, { claim: { kind: "after", code, holdings, outcome, order } });
  } finally {
    key.fill(0);
    void refreshLinks();
  }
}

export function clearClaim(): void {
  if (state.claim.kind !== "moving") set({ claim: { kind: "idle" } });
}

export type GhostLinkMade = "made" | "signed-out" | "taken" | "failed";

/**
 * Makes and lists the trader's next link without paying it, then opens Ghost pay for its address:
 * Ghost Route pays it, so nothing on chain ties the link to whoever made it.
 */
export async function makeGhostLink(): Promise<GhostLinkMade> {
  const open = spending();
  if (!open) return "failed";
  try {
    const index = nextIndex(await readLinks(open.site));
    const key = await linkKey(index);
    if (!key) return "failed";
    try {
      const address = (await privateKeypair(key)).shieldedAddress().solanaAddress();
      const listed = await listLink(open.site, index, address);
      if (listed !== "ok") return listed === "taken" ? "taken" : "failed";
      fundLink(address, linkUrl(open.site, darkLinkCode(key)));
      void refreshLinks();
      return "made";
    } finally {
      key.fill(0);
    }
  } catch (error) {
    return error instanceof SiteError && error.failure === "signed-out" ? "signed-out" : "failed";
  }
}

/** Forgets the links and any outcome: the wallet closed. */
export function forgetLinks(): void {
  turn += 1;
  state = { list: { kind: "reading", rows: null }, back: null, claim: { kind: "idle" } };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const current = () => state;

export const useLinks = () => useSyncExternalStore(subscribe, current, current);
