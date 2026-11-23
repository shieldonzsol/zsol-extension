// What zSol's fee wallet is handed with a send it pays the network fee for: the transaction's
// own viewing key, found from the sender's keys, and each receiver's nullifier key and token, so
// it can open every output to someone else and check it. Never the sender's own keys.
import type { LocalKeys, ShieldedKeypair, Wallet, WalletUtxo } from "@heliuslabs/spr";
import type { SprClient } from "@heliuslabs/spr/client";
import { bytes16, X25519PublicKey } from "@heliuslabs/spr/keypair";
import { decodeConfidential, decodeOutputData } from "@heliuslabs/spr/transaction";
import { fetchUserRecord } from "@heliuslabs/spr/wallet";
import { getAddressDecoder, type Address, type Transaction } from "@solana/kit";

import { ringsTransactOf } from "./transact";

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, at) => byte === b[at]);
const EMBEDDED_KEY_BYTES = 33;

export class SponsorKeysError extends Error {
  override readonly name = "SponsorKeysError";
}

export interface ReceiverKey {
  readonly slot: number;
  readonly asset: Address;
  readonly nullifierPublicKey: Uint8Array;
}

export interface SponsorKeys {
  readonly txViewingKey: Uint8Array;
  readonly receivers: readonly ReceiverKey[];
}

export interface Spender {
  readonly keypair: ShieldedKeypair;
  readonly keys: LocalKeys;
  readonly wallet: Wallet;
}

export async function sponsorKeys(
  client: SprClient,
  spender: Spender,
  transaction: Pick<Transaction, "messageBytes">,
): Promise<SponsorKeys> {
  const ring = ringsTransactOf(transaction);
  if (!ring) throw new SponsorKeysError("This is not a Rings transaction.");
  // The key derives from the transaction's first nullifier: try each output the wallet holds.
  const held: readonly WalletUtxo[] = spender.wallet.utxos();
  const nullifiers = await spender.keys.derive(
    held.map((item) => ({
      kind: "nullifier" as const,
      utxoHash: item.outputContext.hash,
      blinding: item.utxo.blinding,
    })),
  );
  const keys = await spender.keys.transactionKeys(
    nullifiers.map((firstNullifier) => ({
      viewingPublicKey: spender.keypair.viewingPublicKey(),
      firstNullifier,
    })),
  );
  const match = keys.find((key) => same(key.publicKey().toBytes(), ring.view.txViewingPublicKey));
  if (!match) {
    for (const key of keys) key.destroy();
    throw new SponsorKeysError("This wallet did not build this transaction.");
  }
  const txViewingKey = new Uint8Array(match.secretBytes());
  const own = spender.keypair.shieldedAddress().solanaAddress();
  const receivers: ReceiverKey[] = [];
  try {
    for (const [slot, output] of ring.view.outputs.entries()) {
      const tag =
        output.ownerTag.kind === "inline"
          ? output.ownerTag.value
          : (ring.accounts[output.ownerTag.index] ?? new Uint8Array(32));
      const owner = getAddressDecoder().decode(tag);
      if (owner === own || tag.every((byte) => byte === 0) || !output.data) continue;
      const frame = decodeOutputData(output.data);
      const plain = match.decryptSlotEphemeral(
        X25519PublicKey.fromBytes(frame.body.slice(0, EMBEDDED_KEY_BYTES)),
        frame.body.slice(EMBEDDED_KEY_BYTES),
        bytes16(ring.view.salt),
        slot,
      );
      const { assetId } = decodeConfidential(plain);
      // oxlint-disable-next-line no-await-in-loop -- one receiver or two, in order.
      const record = await fetchUserRecord({ rpc: client, owner });
      if (!record) throw new SponsorKeysError(`No private wallet is registered at ${owner}.`);
      receivers.push({
        slot,
        asset: spender.wallet.registry.resolve(assetId),
        nullifierPublicKey: new Uint8Array(record.nullifierPublicKey),
      });
    }
  } finally {
    for (const key of keys) key.destroy();
  }
  return { txViewingKey, receivers };
}
