// zSol's fee wallet's terms, read once for every action and kept a few seconds: who pays the
// network fee, where the fee goes, its rate and least fee, and whether private actions can run.
import { useSyncExternalStore } from "react";

import { feeAt } from "@/features/rings/amount-input";
import { WALLET_ASSETS } from "@/features/rings/holdings";

import {
  DEFAULT_SEND_FEE_BPS,
  DEFAULT_TRADE_FEE_MINIMUM,
  sponsorSetup,
  type SponsorSetup,
} from "./sponsor";

const FRESH_MS = 10_000;

let setup: { readonly value: SponsorSetup; readonly at: number; readonly site: string } | null =
  null;
const listeners = new Set<() => void>();

const publish = () => {
  for (const listener of listeners) listener();
};

export async function termsFor(site: string): Promise<SponsorSetup> {
  if (setup && setup.site === site && Date.now() - setup.at < FRESH_MS) return setup.value;
  const value = await sponsorSetup(site);
  setup = { value, at: Date.now(), site };
  publish();
  return value;
}

/** zSol's terms changed under a send (it found the fee short): read them again next time. */
export function staleTerms() {
  setup = null;
}

/** Reads zSol's terms ahead of the first review, so a form shows them as they are. */
export async function warmTerms(site: string): Promise<void> {
  await termsFor(site).catch(() => undefined);
}

/** zSol's fee terms: which tokens pay it, at what rate, and its least fee. */
export type FeeTerms = Pick<
  SponsorSetup,
  "feeAssets" | "sendFeeBps" | "sendFeeMinimums" | "fundingFeeAhead" | "tradeFeeMinimum"
>;

// What a form shows until zSol's own terms are read.
const ASSUMED: FeeTerms = {
  feeAssets: new Set(WALLET_ASSETS.map((each) => each.mint)),
  sendFeeBps: DEFAULT_SEND_FEE_BPS,
  sendFeeMinimums: new Map(),
  fundingFeeAhead: new Map(),
  tradeFeeMinimum: DEFAULT_TRADE_FEE_MINIMUM,
};

export const currentTerms = (): FeeTerms => setup?.value ?? ASSUMED;

/** zSol's fee on sending `amount` of `mint`: its rate or its least fee, nothing on other tokens. */
type SendTerms = Pick<FeeTerms, "feeAssets" | "sendFeeBps" | "sendFeeMinimums">;

export function feeOn(mint: string, amount: bigint, terms: SendTerms = currentTerms()): bigint {
  return terms.feeAssets.has(mint)
    ? feeAt(amount, terms.sendFeeBps, terms.sendFeeMinimums.get(mint) ?? 0n)
    : 0n;
}

/**
 * zSol's fee on paying `amount` of `mint` into a Dark link: a send's fee, and the claim's network
 * fee paid ahead, on the tokens zSol charges at all.
 */
export function fundingFeeOn(
  mint: string,
  amount: bigint,
  terms: SendTerms & Pick<FeeTerms, "fundingFeeAhead"> = currentTerms(),
): bigint {
  const fee = feeOn(mint, amount, terms);
  return fee > 0n ? fee + (terms.fundingFeeAhead.get(mint) ?? 0n) : 0n;
}

/** zSol's least fee on `mint`, zero when it states none or charges nothing on it. */
export function leastFeeOn(mint: string, terms: SendTerms = currentTerms()): bigint {
  return terms.feeAssets.has(mint) ? (terms.sendFeeMinimums.get(mint) ?? 0n) : 0n;
}

export function forgetTerms() {
  setup = null;
  publish();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFeeTerms(): FeeTerms {
  return useSyncExternalStore(subscribe, currentTerms, currentTerms);
}
