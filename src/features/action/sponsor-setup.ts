// zSol's fee wallet's public terms, as the panel reads and checks them: who pays the network fee,
// where the fee goes, its rates and least fees, and whether private actions can run.
import { address, type Address } from "@solana/kit";

import { siteFetch } from "@/features/rings/site-fetch";

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface SponsorSetup {
  readonly feePayer: Address;
  readonly treasury: Address;
  /** The tokens a send pays zSol's fee in. */
  readonly feeAssets: ReadonlySet<string>;
  /** zSol's fee on a send, in basis points, as zSol states it now. */
  readonly sendFeeBps: bigint;
  /** The least a send's fee is, by token, in its smallest unit. */
  readonly sendFeeMinimums: ReadonlyMap<string, bigint>;
  /** The least zSol's fee is on a trade from the private balance, in lamports. */
  readonly tradeFeeMinimum: bigint;
  /** Null when private actions can run now; otherwise why they can't. */
  readonly paused: "fee-wallet" | "treasury" | "off" | null;
}

/** zSol's fee on a send when it doesn't state one: 0.1%. */
export const DEFAULT_SEND_FEE_BPS = 10n;
/** 1%: the most this panel accepts as a send's fee. */
export const MAX_SEND_FEE_BPS = 100;
/** The most this panel accepts as a send's least fee: 0.001 SOL, 0.1 USDC. */
export const MAX_SEND_FEE_MINIMUMS: Readonly<Record<string, bigint>> = {
  "11111111111111111111111111111111": 1_000_000n,
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 100_000n,
};

/** A trade's least fee when zSol states none, and the most this panel accepts: 0.001 SOL. */
export const DEFAULT_TRADE_FEE_MINIMUM = 30_000n;
export const MAX_TRADE_FEE_MINIMUM = 1_000_000n;

/** zSol answered, but not with its fee wallet's setup. */
export class SetupUnread extends Error {
  override readonly name = "SetupUnread";
}

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null ? Reflect.get(body, name) : undefined;
}

function addressIn(body: unknown, name: string): Address {
  const value = field(body, name);
  if (typeof value !== "string" || !BASE58_ADDRESS.test(value)) throw new SetupUnread(name);
  return address(value);
}

/** What zSol answered for its fee wallet's setup, read and checked. */
export function readSetup(status: number, body: unknown): SponsorSetup {
  if (status === 503 && field(body, "error") === "unavailable") {
    return {
      feePayer: address("11111111111111111111111111111111"),
      treasury: address("11111111111111111111111111111111"),
      feeAssets: new Set(),
      sendFeeBps: DEFAULT_SEND_FEE_BPS,
      sendFeeMinimums: new Map(),
      tradeFeeMinimum: DEFAULT_TRADE_FEE_MINIMUM,
      paused: "off",
    };
  }
  if (status < 200 || status >= 300) throw new SetupUnread(String(status));
  const assets = field(body, "feeAssets");
  const paused = field(body, "paused");
  const bps = field(body, "sendFeeBps");
  // The panel never builds a send whose fee is above these, whatever zSol answers.
  if (typeof bps === "number" && (!Number.isInteger(bps) || bps < 0 || bps > MAX_SEND_FEE_BPS)) {
    throw new SetupUnread("sendFeeBps");
  }
  const minimums = new Map<string, bigint>();
  const stated = field(body, "sendFeeMinimums");
  for (const [mint, value] of Object.entries(
    typeof stated === "object" && stated !== null ? stated : {},
  )) {
    const most = MAX_SEND_FEE_MINIMUMS[mint];
    if (most === undefined) continue;
    if (typeof value !== "string" || !/^\d{1,20}$/.test(value) || BigInt(value) > most) {
      throw new SetupUnread("sendFeeMinimums");
    }
    minimums.set(mint, BigInt(value));
  }
  const tradeLeast = field(body, "tradeFeeMinimum");
  if (
    tradeLeast !== undefined &&
    (typeof tradeLeast !== "string" ||
      !/^\d{1,20}$/.test(tradeLeast) ||
      BigInt(tradeLeast) > MAX_TRADE_FEE_MINIMUM)
  ) {
    throw new SetupUnread("tradeFeeMinimum");
  }
  return {
    feePayer: addressIn(body, "feePayer"),
    treasury: addressIn(body, "treasury"),
    feeAssets: new Set(
      Array.isArray(assets) ? assets.filter((each) => typeof each === "string") : [],
    ),
    sendFeeBps: typeof bps === "number" ? BigInt(bps) : DEFAULT_SEND_FEE_BPS,
    sendFeeMinimums: minimums,
    tradeFeeMinimum:
      typeof tradeLeast === "string" ? BigInt(tradeLeast) : DEFAULT_TRADE_FEE_MINIMUM,
    paused:
      paused === "fee-wallet" || paused === "treasury"
        ? paused
        : field(body, "canPay") === false
          ? "fee-wallet"
          : null,
  };
}

/** zSol's fee wallet's public setup: who pays the network fee, where the fee goes, and its terms. */
export async function sponsorSetup(site: string): Promise<SponsorSetup> {
  // Public terms, the same for everyone: asked without the panel's sign-in.
  const response = await siteFetch(site, true)(`${site}/api/sponsor`, { cache: "no-store" });
  return readSetup(response.status, await response.json().catch(() => null));
}
