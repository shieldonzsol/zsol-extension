// Moving everything a Dark link holds into the open private wallet: its creator taking it back,
// or whoever it was sent to claiming it. One transaction a token, each read from the link again,
// so a claim stopped halfway is finished by the next, never paid twice.
import { SOL_MINT } from "@heliuslabs/spr";
import type { SprClient } from "@heliuslabs/spr/client";
import type { Address } from "@solana/kit";

import { submitSponsored, type SendStep } from "@/features/action/sponsor";
import type { Spender } from "@/features/rings/sponsor-keys";

import {
  buildClaim,
  buildClaimLanded,
  landedAt,
  openLinkWallet,
  privateHoldings,
  type Holding,
} from "./link-wallet";

/** One claim at a time across every panel window: two would spend the same money. */
export const LINK_LOCK = "zsol-link";

export type ClaimStep = "reading" | "proving" | SendStep;

export interface ClaimProgress {
  readonly step: ClaimStep;
  /** Which move, from 1, of how many. */
  readonly move: number;
  readonly moves: number;
}

/** Part of the link moved, then a later move stopped: what moved, and why the rest didn't. */
export class PartlyClaimed extends Error {
  override readonly name = "PartlyClaimed";
  constructor(
    readonly moved: readonly Holding[],
    options: ErrorOptions,
  ) {
    super("Part of the link moved.", options);
  }
}

export interface ClaimInput {
  readonly site: string;
  readonly client: SprClient;
  /** The open private wallet: it receives, and is read back after each move. */
  readonly own: Spender;
  readonly feePayer: Address;
  /** The link's key; it stays the caller's to wipe. */
  readonly key: Uint8Array;
  readonly readBack: (slot: bigint) => Promise<void>;
  readonly onProgress: (progress: ClaimProgress) => void;
  readonly onSigned: (signature: string) => void;
  readonly onSent: (signature: string) => void;
}

function holding<T>(work: () => Promise<T>): Promise<T> {
  return typeof navigator.locks?.request === "function"
    ? navigator.locks.request(LINK_LOCK, work)
    : work();
}

/** Moves all the link holds; what moved comes back, nothing when it held nothing. */
export function claimAll(input: ClaimInput): Promise<Holding[]> {
  return holding(() => claimHeld(input));
}

async function claimHeld(input: ClaimInput): Promise<Holding[]> {
  const { client } = input;
  const to = input.own.keypair.shieldedAddress();
  const first = await openLinkWallet(client, input.key);
  const mints = privateHoldings(first).map(({ mint }) => mint);
  const landed = (await landedAt(client, first)) > 0n;
  const moves = mints.length + (landed ? 1 : 0);
  const moved: Holding[] = [];
  const run = async (
    at: number,
    work: (said: (step: ClaimStep) => void) => Promise<Holding | null>,
  ) => {
    const said = (step: ClaimStep) => input.onProgress({ step, move: at + 1, moves });
    try {
      const done = await work(said);
      if (done) moved.push(done);
    } catch (cause) {
      if (moved.length > 0) throw new PartlyClaimed(moved, { cause });
      throw cause;
    }
  };
  const sent = {
    site: input.site,
    client,
    readBack: input.readBack,
    onSigned: input.onSigned,
    onSent: input.onSent,
  };
  if (landed) {
    await run(0, async (said) => {
      said("reading");
      const lamports = await landedAt(client, first);
      said("proving");
      const built = lamports > 0n ? await buildClaimLanded(client, first, to, lamports) : null;
      if (!built) return null;
      // A deposit into a private balance, its fee paid by the link's own address.
      await submitSponsored({
        ...sent,
        spender: first,
        transaction: built.transaction,
        kind: "sweep",
        onStep: said,
      });
      return { mint: SOL_MINT, amount: lamports - built.fee };
    });
  }
  for (const [index, mint] of mints.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- each move spends what the last one left.
    await run(index + (landed ? 1 : 0), async (said) => {
      said("reading");
      const link = await openLinkWallet(client, input.key);
      said("proving");
      const built = await buildClaim(client, link, input.feePayer, to, mint);
      if (!built) return null;
      await submitSponsored({
        ...sent,
        spender: link,
        transaction: built.transaction,
        known: [to],
        claims: true,
        onStep: said,
      });
      return { mint, amount: built.amount };
    });
  }
  return moved;
}
