// A Dark link's one-time private wallet, opened with its own key: what it holds, privately and at
// its own address, and the transactions that move all of it into a private balance.
import {
  buildDepositTransaction,
  buildTransferTransaction,
  LocalKeys,
  SOL_MINT,
  syncWallet,
  Wallet,
  type ShieldedAddress,
} from "@heliuslabs/spr";
import type { SprClient } from "@heliuslabs/spr/client";
import { address, type Address, type Transaction } from "@solana/kit";

import { heldIn } from "@/features/rings/holdings";
import { privateKeypair } from "@/features/rings/keys";
import { networkFeeOf, SIGNATURE_FEE } from "@/features/rings/network-fee";
import type { Spender } from "@/features/rings/sponsor-keys";

export interface Holding {
  readonly mint: string;
  readonly amount: bigint;
}

/** The link's wallet, synced: what it holds now. */
export async function openLinkWallet(client: SprClient, key: Uint8Array): Promise<Spender> {
  const keypair = await privateKeypair(key);
  const keys = LocalKeys.fromKeypair(keypair, client.proofService);
  const wallet = new Wallet({ identity: keypair.shieldedAddress() });
  await syncWallet({ client, wallet, keys });
  return { keypair, keys, wallet };
}

/** Every token the link holds in its private balance. */
export function privateHoldings(link: Pick<Spender, "wallet">): Holding[] {
  return link.wallet.registry
    .entries()
    .map(([, mint]) => ({ mint: String(mint), amount: heldIn(link.wallet, mint) }))
    .filter((holding) => holding.amount > 0n);
}

/** SOL at the link's own address, in public: where Ghost Route pays a link. */
export async function landedAt(
  client: Pick<SprClient, "solanaRpc">,
  link: Pick<Spender, "keypair">,
): Promise<bigint> {
  const { value } = await client.solanaRpc
    .getBalance(link.keypair.shieldedAddress().solanaAddress(), { commitment: "confirmed" })
    .send();
  return value;
}

/** What a link holds in all: its private balance, and the SOL landed at its address. */
export function withLanded(holdings: readonly Holding[], landed: bigint): Holding[] {
  if (landed <= 0n) return [...holdings];
  const sol = holdings.find((each) => each.mint === SOL_MINT);
  return sol
    ? holdings.map((each) => (each === sol ? { ...each, amount: each.amount + landed } : each))
    : [{ mint: SOL_MINT, amount: landed }, ...holdings];
}

/**
 * The SOL landed at the link's address, deposited into `to`'s private balance. The link's address
 * pays its own network fee from that money, priced by the chain for this very message, and is left
 * empty. Null when what landed can't pay its fee.
 */
export async function buildClaimLanded(
  client: SprClient,
  link: Pick<Spender, "keypair">,
  to: ShieldedAddress,
  lamports: bigint,
): Promise<{ readonly transaction: Transaction; readonly fee: bigint } | null> {
  const depositor = link.keypair.shieldedAddress().solanaAddress();
  const build = (fee: bigint) =>
    buildDepositTransaction({
      client,
      feePayer: depositor,
      depositor,
      recipient: to,
      asset: SOL_MINT,
      amount: lamports - fee,
    });
  if (lamports <= SIGNATURE_FEE) return null;
  const first = await build(SIGNATURE_FEE);
  const fee = await networkFeeOf(client, first);
  if (fee === SIGNATURE_FEE) return { transaction: first, fee };
  if (lamports <= fee) return null;
  return { transaction: await build(fee), fee };
}

/** All the link holds of `mint`, to `to`, with no fee: whoever made the link paid it. */
export async function buildClaim(
  client: SprClient,
  link: Spender,
  feePayer: Address,
  to: ShieldedAddress,
  mint: string,
): Promise<{ readonly transaction: Transaction; readonly amount: bigint } | null> {
  const amount = heldIn(link.wallet, mint);
  if (amount <= 0n) return null;
  const transaction = await buildTransferTransaction({
    client,
    wallet: link.wallet,
    keys: link.keys,
    feePayer,
    recipient: to,
    asset: address(mint),
    amount,
  });
  return { transaction, amount };
}
