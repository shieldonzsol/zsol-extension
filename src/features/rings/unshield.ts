// Unshield: money leaves the private balance for any public address, in public. zSol's fee wallet
// fronts the network fee and the private SOL hands it back in the same transaction, through the
// private wallet's own address; a token's new account at the receiver is paid the same way.
import {
  buildWithdrawalTransaction,
  SOL_MINT,
  type LocalKeys,
  type ShieldedKeypair,
  type Wallet,
} from "@heliuslabs/spr";
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
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

import { heldIn } from "./holdings";
import { networkFeeOf, RINGS_TRANSACT_FEE, twoSignerFee } from "./network-fee";

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

/** The private SOL can't pay the receiver's new token account and the fee: nothing was built. */
export class UnshieldRentShort extends Error {
  override readonly name = "UnshieldRentShort";
  constructor(
    /** The account's rent and the network fee, in lamports. */
    readonly rent: bigint,
    readonly held: bigint,
  ) {
    super(
      `Opening the receiver's account takes ${String(rent)} lamports; ${String(held)} are held.`,
    );
  }
}

/** The private SOL can't pay the amount and its network fee: nothing was built. */
export class UnshieldShort extends Error {
  override readonly name = "UnshieldShort";
  constructor(
    readonly needed: bigint,
    readonly fee: bigint,
    readonly held: bigint,
  ) {
    super(`This needs ${String(needed)} lamports; ${String(held)} are held.`);
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

const isTransaction = (step: Transaction | readonly Instruction[]): step is Transaction =>
  !Array.isArray(step);

/** Built transactions, and instructions of our own between them, as one version 1 transaction. */
async function oneTransaction(
  client: SprClient,
  feePayer: Address,
  steps: readonly (Transaction | readonly Instruction[])[],
): Promise<Transaction> {
  const parts = steps.filter(isTransaction);
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
      (message) =>
        appendTransactionMessageInstructions(
          steps.flatMap((step) => (isTransaction(step) ? instructionsOf(step) : step)),
          message,
        ),
    ),
  );
}

/** What a SOL Unshield hands zSol's fee wallet back, about: the build asks the chain. */
export const UNSHIELD_COST_LAMPORTS = 15_000n;
/** The same for a token to an address with no account for it: two transacts. */
export const OPENING_COST_LAMPORTS = UNSHIELD_COST_LAMPORTS + RINGS_TRANSACT_FEE;

export interface UnshieldBuilt {
  readonly transaction: Transaction;
  /** What the private SOL hands zSol's fee wallet back; zero when zSol keeps the fee. */
  readonly networkFee: bigint;
  /** The receiver's new token account's rent, from the private SOL; zero when none. */
  readonly rent: bigint;
}

/** The fee the chain asks rose above what the transaction hands back: build it again. */
export class UnshieldFeeMoved extends Error {
  override readonly name = "UnshieldFeeMoved";
}

export async function buildUnshield(input: {
  readonly client: SprClient;
  readonly keypair: ShieldedKeypair;
  readonly wallet: Wallet;
  readonly keys: LocalKeys;
  readonly feePayer: Address;
  readonly to: Address;
  readonly asset: Address;
  readonly amount: bigint;
  /** The receiving account as `unshieldAccount` measured it. */
  readonly opening: UnshieldAccount | null;
}): Promise<UnshieldBuilt> {
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
  const isSol = input.asset === SOL_MINT;
  const rent = opening?.rent ?? 0n;
  if (!isSol && rent === 0n) return { transaction: await withdrawal(), networkFee: 0n, rent: 0n };
  const own = input.keypair.shieldedAddress().solanaAddress();
  const transacts = isSol ? 1n : 2n;
  const signatures = await twoSignerFee(input.client, input.feePayer, own);
  const networkFee = signatures + RINGS_TRANSACT_FEE * transacts;
  const held = heldIn(input.wallet, SOL_MINT);
  if (isSol && held < input.amount + networkFee) {
    throw new UnshieldShort(input.amount + networkFee, networkFee, held);
  }
  if (!isSol && held < rent + networkFee) throw new UnshieldRentShort(rent + networkFee, held);
  // The SOL lands at the private wallet's own address first: it signs, so it can pass the amount
  // (or the rent) on and hand the fee back. Building a withdrawal reserves what it spends.
  const self = createNoopSigner(own);
  const leg = await buildWithdrawalTransaction({
    ...common,
    recipient: own,
    asset: SOL_MINT,
    amount: (isSol ? input.amount : rent) + networkFee,
  });
  const passOn =
    isSol && input.to === own
      ? []
      : [
          getTransferSolInstruction({
            source: self,
            destination: isSol ? input.to : opening!.account,
            amount: isSol ? input.amount : rent,
          }),
        ];
  const payBack = getTransferSolInstruction({
    source: self,
    destination: input.feePayer,
    amount: networkFee,
  });
  const transaction = await oneTransaction(
    input.client,
    input.feePayer,
    isSol ? [leg, [...passOn, payBack]] : [leg, [...passOn, payBack], await withdrawal()],
  );
  // Priced on a stand-in before the proof: a chain that now asks more would leave zSol short.
  if ((await networkFeeOf(input.client, transaction)) > signatures) {
    throw new UnshieldFeeMoved("The network fee rose while it was built.");
  }
  return { transaction, networkFee, rent };
}

/** The least SOL a system account holds: a new address paid less can't exist on Solana. */
export async function newAccountFloor(client: SprClient, to: Address): Promise<bigint | null> {
  const [{ value: lamports }, floor] = await Promise.all([
    client.solanaRpc.getBalance(address(to), { commitment: "confirmed" }).send(),
    client.solanaRpc.getMinimumBalanceForRentExemption(0n).send(),
  ]);
  return lamports === 0n ? floor : null;
}
