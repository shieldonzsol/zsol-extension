// Unshield: money leaves the private balance for any public address, in public. A token needs an
// account at the receiver; when there is none, its rent comes from the private SOL in the same
// transaction (a SOL withdrawal to the new account's address first), so zSol's fee wallet pays
// only the network fee.
import { buildWithdrawalTransaction, SOL_MINT, type LocalKeys, type Wallet } from "@heliuslabs/spr";
import type { SprClient } from "@heliuslabs/spr/client";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  decompileTransactionMessage,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  pipe,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type Transaction,
  type V1TransactionConfig,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

import { heldIn } from "./holdings";

/** Two transacts load more account data than the default allows. */
const LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;

/** The program that owns `mint`: the token program, or Token-2022. */
export async function tokenProgramOf(client: SprClient, mint: Address): Promise<Address> {
  const { value } = await client.solanaRpc
    .getAccountInfo(mint, { encoding: "base64", commitment: "confirmed" })
    .send();
  if (!value) throw new Error(`No mint at ${mint}.`);
  return value.owner;
}

/** Where a token Unshield lands, and what opening it costs when it isn't open yet. */
export interface UnshieldAccount {
  readonly account: Address;
  readonly tokenProgram: Address;
  /** Lamports it needs to open, from the private SOL: zero when it is open already. */
  readonly rent: bigint;
}

/**
 * A token Unshield's receiving account and its rent, measured by opening it in a simulation (a
 * Token-2022 account's size depends on its mint). Null for SOL, which needs no account.
 */
export async function unshieldAccount(
  client: SprClient,
  input: { readonly feePayer: Address; readonly to: Address; readonly asset: Address },
): Promise<UnshieldAccount | null> {
  if (input.asset === SOL_MINT) return null;
  const tokenProgram = await tokenProgramOf(client, input.asset);
  const [account] = await findAssociatedTokenPda({
    owner: input.to,
    mint: input.asset,
    tokenProgram,
  });
  const { value: existing } = await client.solanaRpc
    .getAccountInfo(account, { encoding: "base64", commitment: "confirmed" })
    .send();
  if (existing) return { account, tokenProgram, rent: 0n };
  const create = getCreateAssociatedTokenIdempotentInstruction({
    payer: createNoopSigner(input.feePayer),
    ata: account,
    owner: input.to,
    mint: input.asset,
    tokenProgram,
  });
  const { value: lifetime } = await client.solanaRpc.getLatestBlockhash().send();
  const dryRun = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (message) => setTransactionMessageFeePayer(input.feePayer, message),
      (message) => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
      (message) => appendTransactionMessageInstructions([create], message),
    ),
  );
  const { value: simulated } = await client.solanaRpc
    .simulateTransaction(getBase64EncodedWireTransaction(dryRun), {
      encoding: "base64",
      commitment: "confirmed",
      sigVerify: false,
      replaceRecentBlockhash: true,
      accounts: { addresses: [account], encoding: "base64" },
    })
    .send();
  if (simulated.err) {
    throw new Error(
      `Opening the receiver's account failed in simulation: ${JSON.stringify(simulated.err)}`,
    );
  }
  return { account, tokenProgram, rent: BigInt(simulated.accounts?.[0]?.lamports ?? 0) };
}

/** The private SOL can't pay the receiver's new token account: nothing was built. */
export class UnshieldRentShort extends Error {
  override readonly name = "UnshieldRentShort";
  constructor(
    readonly rent: bigint,
    readonly held: bigint,
  ) {
    super(
      `Opening the receiver's account takes ${String(rent)} lamports; ${String(held)} are held.`,
    );
  }
}

const configOf = (transaction: Transaction): V1TransactionConfig =>
  Reflect.get(
    decompileTransactionMessage(
      getCompiledTransactionMessageDecoder().decode(transaction.messageBytes),
    ),
    "config",
  ) ?? {};

const instructionsOf = (transaction: Transaction): readonly Instruction[] =>
  decompileTransactionMessage(
    getCompiledTransactionMessageDecoder().decode(transaction.messageBytes),
  ).instructions;

/** Built transactions as one version 1 transaction, in order, their compute summed. */
async function oneTransaction(
  client: SprClient,
  feePayer: Address,
  parts: readonly Transaction[],
): Promise<Transaction> {
  const configs = parts.map(configOf);
  const computeUnitLimit = configs.reduce((sum, config) => sum + (config.computeUnitLimit ?? 0), 0);
  const loaded = configs.reduce(
    (most, config) => Math.max(most, config.loadedAccountsDataSizeLimit ?? 0),
    0,
  );
  const priority = configs.reduce<bigint | undefined>(
    (most, config) =>
      config.priorityFeeLamports !== undefined &&
      (most === undefined || config.priorityFeeLamports > most)
        ? config.priorityFeeLamports
        : most,
    undefined,
  );
  const { value: lifetime } = await client.solanaRpc.getLatestBlockhash().send();
  return compileTransaction(
    pipe(
      createTransactionMessage({ version: 1 }),
      (message) => setTransactionMessageFeePayer(feePayer, message),
      (message) => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
      (message) =>
        setTransactionMessageConfig(
          {
            computeUnitLimit,
            loadedAccountsDataSizeLimit: loaded || LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
            ...(priority === undefined ? {} : { priorityFeeLamports: priority }),
          },
          message,
        ),
      (message) => appendTransactionMessageInstructions(parts.flatMap(instructionsOf), message),
    ),
  );
}

export async function buildUnshield(input: {
  readonly client: SprClient;
  readonly wallet: Wallet;
  readonly keys: LocalKeys;
  readonly feePayer: Address;
  readonly to: Address;
  readonly asset: Address;
  readonly amount: bigint;
  /** The receiving account as `unshieldAccount` measured it. */
  readonly opening: UnshieldAccount | null;
}): Promise<Transaction> {
  if (input.amount <= 0n) throw new Error("An amount must be above zero.");
  const common = {
    client: input.client,
    wallet: input.wallet,
    keys: input.keys,
    feePayer: input.feePayer,
  };
  const { opening } = input;
  const program =
    opening && opening.tokenProgram !== TOKEN_PROGRAM_ADDRESS
      ? { splTokenProgram: opening.tokenProgram }
      : {};
  const withdrawal = () =>
    buildWithdrawalTransaction({
      ...common,
      recipient: input.to,
      asset: input.asset,
      amount: input.amount,
      ...program,
    });
  if (!opening || opening.rent === 0n) return withdrawal();
  const held = heldIn(input.wallet, SOL_MINT);
  if (held < opening.rent) throw new UnshieldRentShort(opening.rent, held);
  // The rent first, to the account's address: the account then opens with it.
  const rent = await buildWithdrawalTransaction({
    ...common,
    recipient: opening.account,
    asset: SOL_MINT,
    amount: opening.rent,
  });
  return oneTransaction(input.client, input.feePayer, [rent, await withdrawal()]);
}

/** The least SOL a system account holds: a new address paid less can't exist on Solana. */
export async function newAccountFloor(client: SprClient, to: Address): Promise<bigint | null> {
  const [{ value: lamports }, floor] = await Promise.all([
    client.solanaRpc.getBalance(address(to), { commitment: "confirmed" }).send(),
    client.solanaRpc.getMinimumBalanceForRentExemption(0n).send(),
  ]);
  return lamports === 0n ? floor : null;
}
