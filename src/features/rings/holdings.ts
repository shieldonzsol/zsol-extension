// What the private balance and the ghost wallets hold.
import type { Wallet } from "@heliuslabs/spr";
import type { SprClient } from "@heliuslabs/spr/client";
import { address, type Address } from "@solana/kit";

export interface Asset {
  readonly mint: string;
  readonly symbol: string;
  readonly decimals: number;
  /** Decimals a card shows: 2 for a stablecoin, as dollars read, 4 for anything else. */
  readonly places: number;
}

export const SOL: Asset = {
  mint: "11111111111111111111111111111111",
  symbol: "SOL",
  decimals: 9,
  places: 4,
};

/** The assets the private balance shows on mainnet. */
export const WALLET_ASSETS: readonly Asset[] = [
  SOL,
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, places: 2 },
];

/** What a private wallet holds of one asset, zero for one it never held (the SDK throws there). */
export function heldIn(wallet: Wallet, asset: string): bigint {
  return wallet.registry.entries().some(([, known]) => known === asset)
    ? wallet.balance(address(asset)).amount
    : 0n;
}

const BALANCES_PER_CALL = 100;

/** The SOL of each address, a hundred a call; null where a call got no answer. */
export async function solOf(
  client: Pick<SprClient, "solanaRpc">,
  addresses: readonly Address[],
): Promise<(bigint | null)[]> {
  const calls: Address[][] = [];
  for (let at = 0; at < addresses.length; at += BALANCES_PER_CALL) {
    calls.push(addresses.slice(at, at + BALANCES_PER_CALL));
  }
  const read = await Promise.all(
    calls.map((asked) =>
      client.solanaRpc
        .getMultipleAccounts(asked, {
          encoding: "base64",
          commitment: "confirmed",
          dataSlice: { offset: 0, length: 0 },
        })
        .send()
        .then(
          ({ value }): (bigint | null)[] => asked.map((_, at) => value[at]?.lamports ?? 0n),
          (): (bigint | null)[] => asked.map(() => null),
        ),
    ),
  );
  return read.flat();
}

/**
 * How many ghost wallets to show: every one up to the last that holds anything, and at least
 * the `known` this panel has seen before.
 */
export function ghostCount(known: number, holds: readonly boolean[], most: number): number {
  return Math.min(Math.max(known, holds.lastIndexOf(true) + 1), most);
}
