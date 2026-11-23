// The open private wallet: the last balance kept in this browser shows at once, zSol checks the
// account, then the wallet syncs what is new. A failed read keeps the last balance on screen with
// its age and a plain reason, and reads again when the browser is back online.
import {
  LocalKeys,
  loadPersistedWallet,
  syncPersistedWallet,
  Wallet,
  walletSnapshotCipher,
  type ShieldedKeypair,
  type WalletStateCipher,
} from "@heliuslabs/spr";
import { isWalletRegistered } from "@heliuslabs/spr/wallet";
import { address, type Address } from "@solana/kit";
import { useSyncExternalStore } from "react";

import { checkAccount } from "@/features/rings/account";
import { lastUnanswered, ringsClient, type SprClient } from "@/features/rings/client";
import { ghostCount, heldIn, solOf, WALLET_ASSETS, type Asset } from "@/features/rings/holdings";
import { ghostWallet, MAX_GHOST_WALLETS, privateKeypair } from "@/features/rings/keys";
import { SiteError, type SiteFailure } from "@/features/rings/site-api";
import { snapshotStore, type SnapshotStore } from "@/features/rings/snapshot-store";

/** Why the wallet can't open: zSol refused the account check. */
export type Refusal = "signed-out" | "sanctioned" | "taken" | "refused";
/** Why a read didn't finish: worth trying again. */
export type Hitch = Exclude<SiteFailure, "signed-out" | "refused"> | "failed";

export interface Balance {
  readonly asset: Asset;
  readonly amount: bigint;
}

export interface GhostRow {
  /** Its number, from 0: "Ghost 1" is number 0. */
  readonly index: number;
  readonly address: Address;
  /** Null when the chain didn't answer for it. */
  readonly sol: bigint | null;
}

export interface Ghosts {
  readonly rows: readonly GhostRow[];
  /** Every address the trader may have was read. */
  readonly complete: boolean;
  readonly reading: boolean;
  readonly hitch: Hitch | null;
}

export type WalletView =
  | { readonly kind: "closed" }
  | {
      readonly kind: "opening" | "open";
      /** The private wallet's own address, once derived. */
      readonly address: string | null;
      /** The last balance known: from this browser while opening, then from the chain. */
      readonly balances: readonly Balance[] | null;
      /** When `balances` were read from the chain. */
      readonly readAt: number | null;
      readonly reading: boolean;
      /** Why the last read didn't finish; `balances` are then as of `readAt`. */
      readonly hitch: Hitch | null;
      /** Listed in the registry, so others can pay it by address. */
      readonly registered: boolean | null;
      readonly ghosts: Ghosts | null;
    }
  | { readonly kind: "refused"; readonly refusal: Refusal; readonly address: string | null };

interface Opened {
  readonly site: string;
  readonly seed: Uint8Array;
  readonly keypair: ShieldedKeypair;
  readonly store: SnapshotStore;
  readonly cipher: WalletStateCipher;
  wallet: Wallet;
  client: SprClient | null;
  keys: LocalKeys | null;
  /** Every ghost address the trader may have, made once. */
  ghostAddresses: Promise<Address[]> | null;
  /** Every one of them was read once: later reads ask only for those shown and a few past. */
  scanned: boolean;
}

/** Ghost addresses a later read asks for past the last one shown. */
const LOOK_AHEAD = 3;
const FIRST_ANSWER = 100;

let view: WalletView = { kind: "closed" };
let opened: Opened | null = null;
/** What the last open was given, to start it again when it failed before the wallet opened. */
let asked: { readonly seed: Uint8Array; readonly site: string } | null = null;
/** Bumped on every open and close: work from an older turn never reaches the screen. */
let turn = 0;
const listeners = new Set<() => void>();

function publish(next: WalletView) {
  view = next;
  for (const listener of listeners) listener();
}

function patch(at: number, change: Partial<Extract<WalletView, { kind: "opening" | "open" }>>) {
  if (at !== turn || (view.kind !== "opening" && view.kind !== "open")) return;
  publish({ ...view, ...change });
}

const balancesOf = (wallet: Wallet): Balance[] =>
  WALLET_ASSETS.map((asset) => ({ asset, amount: heldIn(wallet, asset.mint) }));

/** Why work begun at `since` failed: zSol's own word, or whether zSol answered at all. */
function hitchOf(error: unknown, since = Date.now()): Hitch | Refusal {
  if (error instanceof SiteError) return error.failure;
  if (!navigator.onLine) return "offline";
  return lastUnanswered() >= since ? "unreachable" : "failed";
}

const isRefusal = (value: Hitch | Refusal): value is Refusal =>
  value === "signed-out" || value === "refused";

const owner = (current: Opened): string => current.keypair.shieldedAddress().solanaAddress();

/** Opens the private wallet the seed names, for the zSol at `site`. */
export async function openWallet(seed: Uint8Array, site: string): Promise<void> {
  turn += 1;
  const at = turn;
  asked = { seed, site };
  opened = null;
  publish({
    kind: "opening",
    address: null,
    balances: null,
    readAt: null,
    reading: true,
    hitch: null,
    registered: null,
    ghosts: null,
  });
  try {
    const keypair = await privateKeypair(seed);
    const wallet = keypair.shieldedAddress().solanaAddress();
    const store = snapshotStore("mainnet", wallet);
    const cipher = walletSnapshotCipher(keypair);
    const [restored, readAt] = await Promise.all([
      loadPersistedWallet({ store, cipher }).catch(() => undefined),
      store.readAt().catch(() => null),
    ]);
    if (at !== turn) return;
    opened = {
      site,
      seed,
      keypair,
      store,
      cipher,
      wallet: restored ?? new Wallet({ identity: keypair.shieldedAddress() }),
      client: null,
      keys: null,
      ghostAddresses: null,
      scanned: false,
    };
    patch(at, {
      address: wallet,
      ...(restored ? { balances: balancesOf(restored), readAt } : {}),
    });
  } catch {
    patch(at, { reading: false, hitch: "failed" });
    return;
  }
  await connectAndRead(at);
}

/** The account check, then the first read; again after a hitch. */
async function connectAndRead(at: number): Promise<void> {
  const current = opened;
  if (!current) return;
  const since = Date.now();
  patch(at, { reading: true, hitch: null });
  try {
    const check = await checkAccount(current.site, current.keypair);
    if (at !== turn) return;
    if (check !== "ok") {
      publish({ kind: "refused", refusal: check, address: owner(current) });
      return;
    }
    current.client ??= await ringsClient(current.site);
    current.keys ??= LocalKeys.fromKeypair(current.keypair, current.client.proofService);
    if (at !== turn || view.kind !== "opening") return;
    publish({ ...view, kind: "open" });
  } catch (error) {
    const why = hitchOf(error, since);
    if (at !== turn) return;
    if (isRefusal(why)) {
      publish({ kind: "refused", refusal: why, address: owner(current) });
    } else {
      patch(at, { reading: false, hitch: why });
    }
    return;
  }
  await Promise.all([read(at), readGhosts(at)]);
}

/** One at a time: a read and a send never touch the wallet's notes at once. */
let lane: Promise<unknown> = Promise.resolve();

export function inWalletLane<T>(work: () => Promise<T>): Promise<T> {
  const run = lane.then(work, work);
  lane = run.catch(() => undefined);
  return run;
}

function sync(current: Opened, requireSlot?: bigint) {
  const { client, keys } = current;
  if (!client || !keys) throw new Error("The wallet isn't open.");
  return syncPersistedWallet({
    client,
    wallet: current.wallet,
    keys,
    store: current.store,
    cipher: current.cipher,
    ...(requireSlot === undefined ? {} : { config: { requireSlot } }),
  });
}

/** What a send spends with: the open wallet, its keys and its client. Null until it opens. */
export function spending() {
  const current = opened;
  if (view.kind !== "open" || !current?.client || !current.keys) return null;
  return {
    site: current.site,
    client: current.client,
    spender: { keypair: current.keypair, keys: current.keys, wallet: current.wallet },
  };
}

/** Reads the wallet once a send landed at `slot`, so the balance on screen includes it. */
export function readBack(slot: bigint): Promise<void> {
  const at = turn;
  const current = opened;
  if (!current) return Promise.reject(new Error("The wallet isn't open."));
  return inWalletLane(async () => {
    await sync(current, slot);
    patch(at, { balances: balancesOf(current.wallet), readAt: Date.now(), hitch: null });
  });
}

/** Syncs what is new, keeps the sealed snapshot, and reads whether the wallet is listed. */
async function read(at: number): Promise<void> {
  const current = opened;
  if (!current?.client || !current.keys) return;
  const since = Date.now();
  patch(at, { reading: true });
  try {
    if (!navigator.onLine) throw new SiteError("offline");
    const [, registered] = await Promise.all([
      inWalletLane(() => sync(current)),
      isWalletRegistered({ rpc: current.client, owner: address(owner(current)) }).catch(() => null),
    ]);
    patch(at, {
      balances: balancesOf(current.wallet),
      readAt: Date.now(),
      reading: false,
      hitch: null,
      ...(registered === null ? {} : { registered }),
    });
  } catch (error) {
    const why = hitchOf(error, since);
    patch(at, { reading: false, hitch: isRefusal(why) ? "failed" : why });
  }
}

/** The rows to show: every ghost wallet up to the last holding SOL, and at least `known`. */
function ghostRows(
  addresses: readonly Address[],
  sol: readonly (bigint | null)[],
  known: number,
): GhostRow[] {
  const count = ghostCount(
    known,
    sol.map((lamports) => (lamports ?? 0n) > 0n),
    MAX_GHOST_WALLETS,
  );
  return addresses
    .slice(0, count)
    .map((ghost, index) => ({ index, address: ghost, sol: sol[index] ?? null }));
}

/**
 * The ghost wallets. The first read asks for every address the trader may have, a hundred a
 * call, the first hundred answering first; later reads ask for those shown and a few past them.
 */
async function readGhosts(at: number): Promise<void> {
  const current = opened;
  if (!current?.client) return;
  const client = current.client;
  const since = Date.now();
  const previous = view.kind === "open" ? view.ghosts : null;
  const known = previous?.rows.length ?? 0;
  patch(at, {
    ghosts: { rows: previous?.rows ?? [], complete: false, reading: true, hitch: null },
  });
  try {
    current.ghostAddresses ??= Promise.all(
      Array.from({ length: MAX_GHOST_WALLETS }, (_, index) =>
        ghostWallet(current.seed, index).then((ghost) => ghost.address),
      ),
    );
    const addresses = await current.ghostAddresses;
    const scope = current.scanned
      ? Math.min(known + LOOK_AHEAD, MAX_GHOST_WALLETS)
      : MAX_GHOST_WALLETS;
    const first = await solOf(client, addresses.slice(0, Math.min(scope, FIRST_ANSWER)));
    if (first.every((lamports) => lamports === null)) {
      throw new SiteError(navigator.onLine ? "unreachable" : "offline");
    }
    const rest = scope > FIRST_ANSWER ? addresses.slice(FIRST_ANSWER, scope) : [];
    patch(at, {
      ghosts: {
        rows: ghostRows(addresses, first, known),
        complete: false,
        reading: rest.length > 0,
        hitch: null,
      },
    });
    const sol = rest.length > 0 ? [...first, ...(await solOf(client, rest))] : first;
    const whole = sol.every((lamports) => lamports !== null);
    if (whole) current.scanned = true;
    patch(at, {
      ghosts: {
        rows: ghostRows(addresses, sol, known),
        complete: whole,
        reading: false,
        hitch: whole ? null : "unreachable",
      },
    });
  } catch (error) {
    const why = hitchOf(error, since);
    patch(at, {
      ghosts: {
        rows: previous?.rows ?? [],
        complete: false,
        reading: false,
        hitch: isRefusal(why) ? "failed" : why,
      },
    });
  }
}

/** Reads the balance and the ghost wallets again, or retries the check that didn't finish. */
export async function readAgain(): Promise<void> {
  const at = turn;
  if (view.kind === "opening" && !view.reading) {
    if (opened) await connectAndRead(at);
    else if (asked) await openWallet(asked.seed, asked.site);
    return;
  }
  if (view.kind !== "open" || view.reading) return;
  await Promise.all([read(at), view.ghosts?.reading ? undefined : readGhosts(at)]);
}

/** Forgets the wallet: what this page read, its keys, and any read still running. */
export function closeWallet(): void {
  turn += 1;
  opened = null;
  asked = null;
  publish({ kind: "closed" });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const currentView = () => view;

export function useWallet(): WalletView {
  return useSyncExternalStore(subscribe, currentView, currentView);
}
