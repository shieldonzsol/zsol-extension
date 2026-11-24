// Move to private: what the zSol address holds in public, deposited into the private balance, so
// the address ends empty. An unregistered wallet registers itself first from that money. The
// address pays its own network fee, or hands back the one zSol's fee wallet fronts. A token the
// private pool can't take stays, and the rest still moves.
import { buildDepositTransaction, SOL_MINT, type ShieldedKeypair } from "@heliuslabs/spr";
import { getSplAssetRegistryAddress } from "@heliuslabs/spr/addresses";
import type { SprClient } from "@heliuslabs/spr/client";
import { getRegisterInstructionAsync } from "@heliuslabs/spr/instructions";
import { isWalletRegistered } from "@heliuslabs/spr/wallet";
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
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { getCloseAccountInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import { networkFeeOf, SIGNATURE_FEE } from "./network-fee";

const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const WRAPPED_SOL = address("So11111111111111111111111111111111111111112");
/** A registry record's size: its rent is read for it. */
export const REGISTRY_RECORD_SPACE = 100n;
/** As zsol.cc sends it: within zSol's fee wallet's cap of 10,000. */
const PRIORITY_FEE = 10_000n;
const SWEEP_COMPUTE_UNITS = 600_000;
const LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;

export interface PublicToken {
  readonly mint: Address;
  readonly account: Address;
  readonly program: Address;
  readonly amount: bigint;
  readonly decimals: number;
  /** The account's own lamports, back to the address when it is closed. */
  readonly rent: bigint;
  readonly frozen: boolean;
  /** Wrapped SOL: closing the account unwraps it, and it moves with the SOL. */
  readonly wrapped: boolean;
}

/** What the zSol address holds in public. */
export interface PublicMoney {
  readonly owner: Address;
  readonly lamports: bigint;
  /** The least a system account keeps while it holds any SOL. */
  readonly reserve: bigint;
  readonly tokens: readonly PublicToken[];
}

/** Why a token stays at the address. */
export type StayReason = "new-to-rings" | "frozen" | "fails";

export interface StayingToken {
  readonly token: PublicToken;
  readonly why: StayReason;
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

function parsedTokenOf(
  data: unknown,
): { mint: string; amount: string; decimals: number; frozen: boolean } | null {
  const info = field(field(data, "parsed"), "info");
  const mint = field(info, "mint");
  const tokenAmount = field(info, "tokenAmount");
  const amount = field(tokenAmount, "amount");
  const decimals = field(tokenAmount, "decimals");
  if (typeof mint !== "string" || typeof amount !== "string" || typeof decimals !== "number") {
    return null;
  }
  if (!/^\d{1,20}$/.test(amount)) return null;
  return { mint, amount, decimals, frozen: field(info, "state") === "frozen" };
}

/** The address's token accounts under both token programs. */
async function tokensOf(client: SprClient, owner: Address): Promise<PublicToken[]> {
  const byProgram = async (programId: Address) => {
    const { value } = await client.solanaRpc
      .getTokenAccountsByOwner(
        owner,
        { programId },
        { encoding: "jsonParsed", commitment: "confirmed" },
      )
      .send();
    return value.flatMap((entry): PublicToken[] => {
      const parsed = parsedTokenOf(entry.account.data);
      if (!parsed) return [];
      const mint = address(parsed.mint);
      return [
        {
          mint,
          account: entry.pubkey,
          program: programId,
          amount: BigInt(parsed.amount),
          decimals: parsed.decimals,
          rent: BigInt(entry.account.lamports),
          frozen: parsed.frozen,
          wrapped: mint === WRAPPED_SOL && programId === TOKEN_PROGRAM_ADDRESS,
        },
      ];
    });
  };
  const [classic, extended] = await Promise.all([
    byProgram(TOKEN_PROGRAM_ADDRESS),
    byProgram(TOKEN_2022),
  ]);
  return [...classic, ...extended];
}

export async function publicMoneyOf(client: SprClient, owner: Address): Promise<PublicMoney> {
  const [{ value: lamports }, reserve, tokens] = await Promise.all([
    client.solanaRpc.getBalance(owner, { commitment: "confirmed" }).send(),
    client.solanaRpc.getMinimumBalanceForRentExemption(0n).send(),
    tokensOf(client, owner),
  ]);
  return { owner, lamports, reserve, tokens };
}

/** Whether there is money to move: SOL, or a token with an amount. */
export const holdsMoney = (money: PublicMoney) =>
  money.lamports > 0n || money.tokens.some((token) => token.amount > 0n);

/** The first move must register the wallet, and the address holds too little SOL to pay it. */
export class SweepShortOfRent extends Error {
  override readonly name = "SweepShortOfRent";
  constructor(
    /** The registry record's rent and the network fee, in lamports. */
    readonly rent: bigint,
    readonly held: bigint,
  ) {
    super(`The address holds ${String(held)} lamports and needs ${String(rent)}.`);
  }
}

/** The SOL that would move is less than the network fee it must hand back. */
export class SweepTooSmall extends Error {
  override readonly name = "SweepTooSmall";
  constructor(
    readonly fee: bigint,
    readonly held: bigint,
  ) {
    super(`The move's network fee is ${String(fee)} lamports; ${String(held)} would move.`);
  }
}

/** The move fails in simulation for a reason no token explains: nothing was signed. */
export class SweepWouldFail extends Error {
  override readonly name = "SweepWouldFail";
}

/** Who pays the network fee, and how much SOL moves through the address. */
export function sweepFlow(input: {
  readonly lamports: bigint;
  readonly reserve: bigint;
  readonly registryRent: bigint | null;
  /** The lamports of the token accounts the move closes. */
  readonly closed: bigint;
  /** The fee if the address pays it itself. */
  readonly selfFee: bigint;
}): { readonly flowing: bigint; readonly selfPaid: boolean } {
  const flowing = input.lamports - (input.registryRent ?? 0n) + input.closed;
  // It pays first when, the fee taken, it still holds its rent-exempt minimum.
  const selfPaid = input.lamports - input.selfFee >= input.reserve && flowing >= input.selfFee;
  return { flowing, selfPaid };
}

/** What the fee takes, what is handed back to zSol, and the SOL that goes in. */
export function sweepSplit(input: {
  readonly flowing: bigint;
  readonly selfPaid: boolean;
  readonly fee: bigint;
}): { readonly paysBack: bigint; readonly sol: bigint; readonly paid: bigint } {
  const { flowing, selfPaid, fee } = input;
  if (!selfPaid && flowing > 0n && flowing < fee) throw new SweepTooSmall(fee, flowing);
  const paysBack = !selfPaid && flowing >= fee ? fee : 0n;
  const paid = selfPaid ? fee : paysBack;
  const sol = flowing - paid;
  return { paysBack, sol: sol > 0n ? sol : 0n, paid };
}

const instructionsOf = (transaction: Transaction): readonly Instruction[] =>
  decompileTransactionMessage(
    getCompiledTransactionMessageDecoder().decode(transaction.messageBytes),
  ).instructions;

/** The instruction a simulation failed at, if it names one. */
export function failedInstructionOf(err: unknown): number | null {
  const at: unknown = field(err, "InstructionError");
  if (!Array.isArray(at)) return null;
  const [index] = at as unknown[];
  if (typeof index === "number") return index;
  return typeof index === "bigint" ? Number(index) : null;
}

/** Tokens with an amount whose deposit Rings can't take as they stand. */
async function stayingOf(
  client: SprClient,
  tokens: readonly PublicToken[],
): Promise<StayingToken[]> {
  const asked = tokens.filter((token) => token.amount > 0n && !token.wrapped);
  const frozen = asked.filter((token) => token.frozen);
  const open = asked.filter((token) => !token.frozen);
  if (open.length === 0) return frozen.map((token) => ({ token, why: "frozen" }));
  const registries = await Promise.all(open.map((token) => getSplAssetRegistryAddress(token.mint)));
  const { value } = await client.solanaRpc
    .getMultipleAccounts(registries, {
      encoding: "base64",
      commitment: "confirmed",
      dataSlice: { offset: 0, length: 8 },
    })
    .send();
  // A token Rings never took needs its interface made first, which a move doesn't do.
  const fresh = open.filter((_, at) => {
    const data = value[at]?.data;
    return !Array.isArray(data) || data[0] === "";
  });
  return [
    ...frozen.map((token) => ({ token, why: "frozen" as const })),
    ...fresh.map((token) => ({ token, why: "new-to-rings" as const })),
  ];
}

export interface Sweep {
  readonly transaction: Transaction;
  readonly money: PublicMoney;
  /** The registry record's rent this move pays, when it also registers the wallet. */
  readonly registryRent: bigint | null;
  /** The network fee the address pays, itself or handed back; zero when fronted. */
  readonly networkFee: bigint;
  /** The SOL that goes into the private balance, unwrapped SOL and closed accounts' rent too. */
  readonly sol: bigint;
  readonly moved: readonly PublicToken[];
  readonly staying: readonly StayingToken[];
  /** Empty token accounts it closes, their rent coming in with the SOL. */
  readonly closesEmpty: number;
  /** Wrapped SOL it unwraps, in lamports, coming in with the SOL. */
  readonly unwrapped: bigint;
}

/** Nothing can move: what is there stays, each for its reason. */
export interface NothingToMove {
  readonly nothing: true;
  readonly staying: readonly StayingToken[];
}

/** Throws `SweepShortOfRent`, `SweepTooSmall` and `SweepWouldFail`. */
export async function buildSweep(
  client: SprClient,
  input: { readonly keypair: ShieldedKeypair; readonly feePayer: Address },
): Promise<Sweep | NothingToMove> {
  const shielded = input.keypair.shieldedAddress();
  const trader = shielded.solanaAddress();
  const [money, registered] = await Promise.all([
    publicMoneyOf(client, trader),
    isWalletRegistered({ rpc: client, owner: trader }),
  ]);
  const staying = await stayingOf(client, money.tokens);
  const kept = new Set(staying.map((each) => each.token.account));
  const movable =
    money.lamports > 0n ||
    money.tokens.some(
      (token) =>
        !kept.has(token.account) &&
        (token.amount > 0n || (token.program === TOKEN_PROGRAM_ADDRESS && !token.frozen)),
    );
  if (!movable) return { nothing: true, staying };
  let registryRent: bigint | null = null;
  if (!registered) {
    registryRent = await client.solanaRpc
      .getMinimumBalanceForRentExemption(REGISTRY_RECORD_SPACE)
      .send();
    const needed = registryRent + SIGNATURE_FEE * 2n + PRIORITY_FEE;
    if (money.lamports < needed) throw new SweepShortOfRent(needed, money.lamports);
  }
  const self = createNoopSigner(trader);
  const register =
    registryRent === null
      ? []
      : [
          await getRegisterInstructionAsync({
            owner: self,
            payer: self,
            nullifierPublicKey: input.keypair.nullifierPublicKey(),
            viewingPublicKey: input.keypair.viewingPublicKey().toBytes(),
          }),
        ];
  const { value: lifetime } = await client.solanaRpc.getLatestBlockhash().send();
  const selfFee = SIGNATURE_FEE + PRIORITY_FEE;

  // Each try leaves out the token a simulation failed on; at most once a token, then once more.
  for (let tries = 0; tries <= money.tokens.length; tries += 1) {
    const stays = new Set(staying.map((each) => each.token.account));
    const moving = money.tokens.filter(
      (token) => token.amount > 0n && !token.wrapped && !stays.has(token.account),
    );
    // Classic accounts it empties close, wrapped SOL unwrapping; those that stay are kept.
    const closing = money.tokens.filter(
      (token) =>
        token.program === TOKEN_PROGRAM_ADDRESS && !token.frozen && !stays.has(token.account),
    );
    const closed = closing.reduce((sum, token) => sum + token.rent, 0n);
    const { flowing, selfPaid } = sweepFlow({
      lamports: money.lamports,
      reserve: money.reserve,
      registryRent,
      closed,
      selfFee,
    });
    const feePayer = selfPaid ? trader : input.feePayer;

    const fixed: Instruction[] = [...register];
    const owners: (PublicToken | null)[] = register.map(() => null);
    for (const token of money.tokens) {
      if (moving.includes(token)) {
        // oxlint-disable-next-line no-await-in-loop -- one deposit per token, in order.
        const deposit = await buildDepositTransaction({
          client,
          feePayer,
          depositor: trader,
          recipient: shielded,
          asset: token.mint,
          amount: token.amount,
          createSplInterface: false,
          ...(token.program === TOKEN_PROGRAM_ADDRESS ? {} : { splTokenProgram: token.program }),
        });
        const legs = instructionsOf(deposit);
        fixed.push(...legs);
        owners.push(...legs.map(() => token));
      }
      if (closing.includes(token)) {
        fixed.push(
          getCloseAccountInstruction({ account: token.account, destination: trader, owner: self }),
        );
        owners.push(token);
      }
    }

    const compile = async (fee: bigint) => {
      const split = sweepSplit({ flowing, selfPaid, fee });
      // Fronted, the fee is handed back to zSol's fee wallet before the rest of the SOL goes in.
      const rest: Instruction[] =
        split.paysBack > 0n
          ? [
              getTransferSolInstruction({
                source: self,
                destination: input.feePayer,
                amount: split.paysBack,
              }),
            ]
          : [];
      if (split.sol > 0n) {
        const deposit = await buildDepositTransaction({
          client,
          feePayer,
          depositor: trader,
          recipient: shielded,
          asset: SOL_MINT,
          amount: split.sol,
        });
        rest.push(...instructionsOf(deposit));
      }
      if (moving.length === 0 && split.sol === 0n) return null;
      return {
        ...split,
        transaction: compileTransaction(
          pipe(
            createTransactionMessage({ version: 1 }),
            (message) => setTransactionMessageFeePayer(feePayer, message),
            (message) => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
            (message) =>
              setTransactionMessageConfig(
                {
                  computeUnitLimit: SWEEP_COMPUTE_UNITS,
                  loadedAccountsDataSizeLimit: LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
                  priorityFeeLamports: PRIORITY_FEE,
                },
                message,
              ),
            (message) => appendTransactionMessageInstructions([...fixed, ...rest], message),
          ),
        ),
      };
    };
    // Built on a guess, then again only when the chain prices it differently.
    const guess = selfPaid ? selfFee : SIGNATURE_FEE * 2n + PRIORITY_FEE;
    // oxlint-disable-next-line no-await-in-loop -- each try depends on the last.
    const first = await compile(guess);
    if (!first) return { nothing: true, staying };
    // oxlint-disable-next-line no-await-in-loop
    const fee = await networkFeeOf(client, first.transaction);
    // oxlint-disable-next-line no-await-in-loop
    const built = fee === guess ? first : await compile(fee);
    if (!built) return { nothing: true, staying };

    // oxlint-disable-next-line no-await-in-loop
    const { value: dryRun } = await client.solanaRpc
      .simulateTransaction(getBase64EncodedWireTransaction(built.transaction), {
        encoding: "base64",
        commitment: "confirmed",
        sigVerify: false,
        replaceRecentBlockhash: true,
      })
      .send();
    if (!dryRun.err) {
      return {
        transaction: built.transaction,
        money,
        registryRent,
        networkFee: built.paid,
        sol: built.sol,
        moved: moving,
        staying,
        closesEmpty: closing.filter((token) => token.amount === 0n).length,
        unwrapped: closing
          .filter((token) => token.wrapped)
          .reduce((sum, token) => sum + token.amount, 0n),
      };
    }
    const at = failedInstructionOf(dryRun.err);
    const culprit = at === null ? null : (owners[at] ?? null);
    if (!culprit) {
      throw new SweepWouldFail(
        `Move to private fails in simulation: ${JSON.stringify(dryRun.err, (_, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
        )}`,
      );
    }
    staying.push({ token: culprit, why: "fails" });
  }
  throw new SweepWouldFail("Move to private kept failing in simulation.");
}
