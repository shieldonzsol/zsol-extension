// A trade from the private balance in one version 1 transaction: the Rings withdrawal and
// deposit, Jupiter's swap between them. Built here, signed by the private wallet's own key and
// zSol's fee wallet, which pays.
import {
  buildDepositTransaction,
  buildWithdrawalTransaction,
  SOL_MINT,
  type LocalKeys,
  type ShieldedKeypair,
  type Wallet,
} from "@heliuslabs/spr";
import type { SprClient } from "@heliuslabs/spr/client";
import {
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
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

import { tokenProgramOf } from "./unshield";
import {
  accountsOpened,
  checkedSwap,
  swapInstructionsForKit,
  TRADE_MAX_ACCOUNTS,
  TRADE_MAX_BYTES,
  tradeAmounts,
  tradeCosts,
  TradeError,
  WRAPPED_SOL_MINT,
  type TradeAmounts,
  type TradeSwap,
} from "./trade";

/** A buy used about 275,000 compute units on mainnet, a sale about 246,000. */
export const TRADE_COMPUTE_UNITS = 1_000_000;
/** The account data a transaction with two transacts may load (the default is too small). */
export const LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;
/** Token `CloseAccount`: account, destination, owner. */
const CLOSE_ACCOUNT = 9;

export interface TradeTransactionInput {
  readonly keypair: ShieldedKeypair;
  readonly keys: LocalKeys;
  readonly wallet: Wallet;
  /** zSol's fee wallet: pays the network fee and fronts the trader's token account rent (Jupiter's `payer`). */
  readonly feePayer: Address;
  /** zSol's treasury's Solana address: zSol's 1% goes to it in SOL. */
  readonly treasury: Address;
  /** Built for the private wallet's own Solana address as the taker. */
  readonly swap: TradeSwap;
  /** A trade with no SOL side: what its input is worth in SOL, from a quote. */
  readonly solValue?: bigint;
  readonly computeUnitLimit?: number;
  /** The whole priority fee, in lamports (a version 1 transaction prices it per transaction). */
  readonly priorityFeeLamports?: bigint;
  /** The least zSol's fee is on a trade worth anything (zSol's server's terms), in lamports. */
  readonly feeMinimum?: bigint;
}

export interface TradeTransaction extends TradeAmounts {
  /** Unsigned: the trader and zSol's fee wallet sign it. */
  readonly transaction: Transaction;
  /** The private wallet's own Solana address. */
  readonly trader: Address;
  /** The signed transaction's size, of 4,096 bytes. */
  readonly bytes: number;
  /** Its accounts, of 64. */
  readonly accounts: number;
}

/**
 * The instructions inside a transaction the SDK built, for composing them into another one or
 * rebuilding them for a wallet (v0 for one that cannot sign v1). Signer roles stay; signatures
 * do not.
 */
export function transactionInstructions(transaction: Transaction): readonly Instruction[] {
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  return decompileTransactionMessage(compiled).instructions;
}

async function tokensIn(client: SprClient, account: Address): Promise<bigint | null> {
  const { value } = await client.solanaRpc
    .getAccountInfo(account, { encoding: "jsonParsed", commitment: "confirmed" })
    .send();
  if (!value) return null;
  const info: unknown = Reflect.get(Reflect.get(Object(value.data), "parsed") ?? {}, "info");
  const amount: unknown = Reflect.get(Reflect.get(Object(info), "tokenAmount") ?? {}, "amount");
  return typeof amount === "string" && /^\d{1,20}$/.test(amount) ? BigInt(amount) : 0n;
}

/**
 * The rent zSol's fee wallet fronts for the trader's token accounts a trade opens (the swap's
 * setup, and the input's account when a withdrawal of it has none to land in), measured by
 * opening them in a simulation (a Token-2022 account's size depends on its mint), and each new
 * account's rent. Accounts that exist already cost nothing.
 */
export async function frontedRent(
  client: SprClient,
  creates: readonly Instruction[],
  feePayer: Address,
): Promise<{ readonly total: bigint; readonly each: ReadonlyMap<Address, bigint> }> {
  const targets = creates.map((instruction) => instruction.accounts![1]!.address);
  if (targets.length === 0) return { total: 0n, each: new Map() };
  const { value: existing } = await client.solanaRpc
    .getMultipleAccounts(targets, { encoding: "base64", commitment: "confirmed" })
    .send();
  const missing = targets.filter((_, at) => existing[at] === null);
  if (missing.length === 0) return { total: 0n, each: new Map() };
  const { value: lifetime } = await client.solanaRpc.getLatestBlockhash().send();
  const dryRun = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (message) => setTransactionMessageFeePayer(feePayer, message),
      (message) => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
      (message) => appendTransactionMessageInstructions(creates, message),
    ),
  );
  const { value: simulated } = await client.solanaRpc
    .simulateTransaction(getBase64EncodedWireTransaction(dryRun), {
      encoding: "base64",
      commitment: "confirmed",
      sigVerify: false,
      replaceRecentBlockhash: true,
      accounts: { addresses: missing, encoding: "base64" },
    })
    .send();
  if (simulated.err) {
    throw new Error(
      `Opening the trader's token accounts failed in simulation: ${JSON.stringify(simulated.err)}`,
    );
  }
  const each = new Map<Address, bigint>();
  missing.forEach((account, at) => {
    each.set(account, BigInt(simulated.accounts?.[at]?.lamports ?? 0));
  });
  let total = 0n;
  for (const rent of each.values()) total += rent;
  return { total, each };
}

const splProgram = (program: Address) =>
  program === TOKEN_PROGRAM_ADDRESS ? {} : { splTokenProgram: program };

export async function buildTradeTransaction(
  client: SprClient,
  input: TradeTransactionInput,
): Promise<TradeTransaction> {
  const { swap, feePayer } = input;
  const shielded = input.keypair.shieldedAddress();
  const trader = shielded.solanaAddress();
  checkedSwap(swap, { trader, feePayer });
  const inputIsSol = swap.inputMint === WRAPPED_SOL_MINT;
  const outputIsSol = swap.outputMint === WRAPPED_SOL_MINT;

  const tokenAccount = async (mint: Address, tokenProgram: Address) =>
    (await findAssociatedTokenPda({ owner: trader, mint, tokenProgram }))[0];
  const [inputProgram, outputProgram] = await Promise.all([
    inputIsSol ? TOKEN_PROGRAM_ADDRESS : tokenProgramOf(client, swap.inputMint),
    outputIsSol ? TOKEN_PROGRAM_ADDRESS : tokenProgramOf(client, swap.outputMint),
  ]);
  const wrapped = await tokenAccount(WRAPPED_SOL_MINT, TOKEN_PROGRAM_ADDRESS);
  // A withdrawal of a token lands in the trader's account for it: when there is none yet, our
  // fee wallet opens it first, and the trader hands that rent back with the rest.
  const inputAccount = inputIsSol ? null : await tokenAccount(swap.inputMint, inputProgram);
  const inputHeld = inputAccount ? await tokensIn(client, inputAccount) : null;
  const opensInput =
    inputAccount && inputHeld === null
      ? [
          getCreateAssociatedTokenIdempotentInstruction({
            payer: createNoopSigner(feePayer),
            ata: inputAccount,
            owner: trader,
            mint: swap.inputMint,
            tokenProgram: inputProgram,
          }),
        ]
      : [];
  const opened = accountsOpened(swap, feePayer);
  const [lamports, reserve, outputTokens, rent] = await Promise.all([
    client.solanaRpc
      .getBalance(trader, { commitment: "confirmed" })
      .send()
      .then(({ value }) => value),
    client.solanaRpc.getMinimumBalanceForRentExemption(0n).send(),
    outputIsSol
      ? 0n
      : tokenAccount(swap.outputMint, outputProgram).then(
          async (at) => (await tokensIn(client, at)) ?? 0n,
        ),
    frontedRent(
      client,
      [...opensInput, ...swapInstructionsForKit({ ...swap, instructions: opened.instructions })],
      feePayer,
    ),
  ]);
  const inputTokens = inputHeld ?? 0n;

  // Wrapped SOL's account, opened by zSol's fee wallet and closed to the trader by the swap's own
  // clean-up, refunds its rent to the trader within the transaction; every other account the
  // swap opens stays the trader's.
  const swapInstructions = swapInstructionsForKit(swap);
  const closesWrapped = swapInstructions.some(
    (instruction) =>
      instruction.programAddress === TOKEN_PROGRAM_ADDRESS &&
      instruction.data?.[0] === CLOSE_ACCOUNT &&
      instruction.accounts?.[0]?.address === wrapped &&
      instruction.accounts[1]?.address === trader,
  );
  const refunded = closesWrapped ? (rent.each.get(wrapped) ?? 0n) : 0n;
  const costs = tradeCosts(
    swap,
    { fronted: rent.total, refunded },
    input.solValue,
    input.feeMinimum ?? 0n,
  );
  const amounts = tradeAmounts(swap, { lamports, inputTokens, outputTokens, reserve }, costs);

  // The deposit first: building a withdrawal reserves the private balance it spends.
  const deposit = await buildDepositTransaction({
    client,
    feePayer,
    depositor: trader,
    recipient: shielded,
    asset: outputIsSol ? SOL_MINT : swap.outputMint,
    amount: amounts.deposit,
    ...(outputIsSol ? {} : splProgram(outputProgram)),
  });
  const withdrawal = await buildWithdrawalTransaction({
    client,
    wallet: input.wallet,
    keys: input.keys,
    feePayer,
    recipient: trader,
    asset: inputIsSol ? SOL_MINT : swap.inputMint,
    amount: amounts.withdraw,
    ...(inputIsSol ? {} : splProgram(inputProgram)),
  });
  // A trade with no SOL side takes zSol's fee and the rent from the private SOL too.
  const solWithdrawal =
    amounts.withdrawSol > 0n
      ? await buildWithdrawalTransaction({
          client,
          wallet: input.wallet,
          keys: input.keys,
          feePayer,
          recipient: trader,
          asset: SOL_MINT,
          amount: amounts.withdrawSol,
        })
      : null;

  const transfer = (destination: Address, amount: bigint) =>
    amount > 0n
      ? [
          getTransferSolInstruction({
            source: createNoopSigner(trader),
            destination,
            amount,
          }),
        ]
      : [];

  const { value: lifetime } = await client.solanaRpc.getLatestBlockhash().send();
  const transaction = compileTransaction(
    pipe(
      createTransactionMessage({ version: 1 }),
      (message) => setTransactionMessageFeePayer(feePayer, message),
      (message) => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
      (message) =>
        setTransactionMessageConfig(
          {
            computeUnitLimit: input.computeUnitLimit ?? TRADE_COMPUTE_UNITS,
            loadedAccountsDataSizeLimit: LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
            ...(input.priorityFeeLamports === undefined
              ? {}
              : { priorityFeeLamports: input.priorityFeeLamports }),
          },
          message,
        ),
      (message) =>
        appendTransactionMessageInstructions(
          [
            ...opensInput,
            ...transactionInstructions(withdrawal),
            ...(solWithdrawal ? transactionInstructions(solWithdrawal) : []),
            ...swapInstructions,
            // zSol's 1% to its treasury, and the rent zSol's fee wallet fronted handed back.
            ...transfer(input.treasury, amounts.fee),
            ...transfer(feePayer, amounts.rentFronted),
            ...transactionInstructions(deposit),
          ],
          message,
        ),
    ),
  );
  const signers = Object.keys(transaction.signatures).length;
  const bytes = transaction.messageBytes.length + 1 + 64 * signers;
  const accounts = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
    .staticAccounts.length;
  if (bytes > TRADE_MAX_BYTES || accounts > TRADE_MAX_ACCOUNTS) {
    throw new TradeError(
      "too-large",
      `The trade needs ${String(bytes)} bytes and ${String(accounts)} accounts, of ${String(TRADE_MAX_BYTES)} and ${String(TRADE_MAX_ACCOUNTS)}: ask for a route with fewer accounts.`,
    );
  }
  return { transaction, trader, bytes, accounts, ...amounts };
}
