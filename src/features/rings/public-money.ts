// What an address holds in public: its SOL and every token account under both token programs,
// read whole even where the node can't parse an account.
import { address, getAddressDecoder, getBase64Encoder, type Address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import type { SprClient } from "./client";

const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const WRAPPED_SOL = address("So11111111111111111111111111111111111111112");
const WRAPPED_SOL_2022 = address("9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP");
/** The most accounts the chain reads in one call. */
const ACCOUNTS_PER_CALL = 100;

export interface PublicToken {
  readonly mint: Address;
  readonly account: Address;
  readonly program: Address;
  readonly amount: bigint;
  readonly decimals: number;
  /** The account's own lamports, back to the address when it is closed. */
  readonly rent: bigint;
  readonly frozen: boolean;
  /** Wrapped SOL, under either token program: closing the account unwraps it. */
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

export function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

const isWrappedSol = (mint: Address, program: Address) =>
  (mint === WRAPPED_SOL && program === TOKEN_PROGRAM_ADDRESS) ||
  (mint === WRAPPED_SOL_2022 && program === TOKEN_2022);

function parsedTokenOf(
  data: unknown,
): { mint: string; amount: bigint; decimals: number; frozen: boolean } | null {
  const info = field(field(data, "parsed"), "info");
  const mint = field(info, "mint");
  const tokenAmount = field(info, "tokenAmount");
  const amount = field(tokenAmount, "amount");
  const decimals = field(tokenAmount, "decimals");
  if (typeof mint !== "string" || typeof amount !== "string" || typeof decimals !== "number") {
    return null;
  }
  if (!/^\d{1,20}$/.test(amount)) return null;
  return { mint, amount: BigInt(amount), decimals, frozen: field(info, "state") === "frozen" };
}

/** Both token programs lay an account out alike: mint, owner, amount, and its state at 108. */
const TOKEN_ACCOUNT_BYTES = 165;
const STATE_AT = 108;
const INITIALIZED = 1;
const FROZEN = 2;
/** A mint's decimals sit at 44 under both programs. */
const DECIMALS_AT = 44;

const base64Of = (data: unknown): Uint8Array | null =>
  Array.isArray(data) && data[1] === "base64" && typeof data[0] === "string"
    ? new Uint8Array(getBase64Encoder().encode(data[0]))
    : null;

/** An account the node couldn't parse, an extension it doesn't know, read from its bytes. */
export function rawTokenOf(
  data: unknown,
): { mint: Address; amount: bigint; frozen: boolean } | null {
  const bytes = base64Of(data);
  if (!bytes || bytes.length < TOKEN_ACCOUNT_BYTES) return null;
  const state = bytes[STATE_AT];
  if (state !== INITIALIZED && state !== FROZEN) return null;
  return {
    mint: getAddressDecoder().decode(bytes.subarray(0, 32)),
    amount: new DataView(bytes.buffer, bytes.byteOffset + 64, 8).getBigUint64(0, true),
    frozen: state === FROZEN,
  };
}

/** Reads `accounts` a hundred a call, in the order asked; null where there is none. */
export async function readAccounts(
  client: Pick<SprClient, "solanaRpc">,
  accounts: readonly Address[],
  slice: { readonly offset: number; readonly length: number },
): Promise<(Uint8Array | null)[]> {
  const calls: Address[][] = [];
  for (let at = 0; at < accounts.length; at += ACCOUNTS_PER_CALL) {
    calls.push(accounts.slice(at, at + ACCOUNTS_PER_CALL));
  }
  const read = await Promise.all(
    calls.map(async (asked) => {
      const { value } = await client.solanaRpc
        .getMultipleAccounts(asked, {
          encoding: "base64",
          commitment: "confirmed",
          dataSlice: slice,
        })
        .send();
      return asked.map((_, at) => base64Of(value[at]?.data));
    }),
  );
  return read.flat();
}

/** The address's token accounts under both token programs. */
async function tokensOf(
  client: Pick<SprClient, "solanaRpc">,
  owner: Address,
): Promise<PublicToken[]> {
  const byProgram = async (programId: Address) => {
    const { value } = await client.solanaRpc
      .getTokenAccountsByOwner(
        owner,
        { programId },
        { encoding: "jsonParsed", commitment: "confirmed" },
      )
      .send();
    return value.map((entry) => ({ entry, programId }));
  };
  const entries = (
    await Promise.all([byProgram(TOKEN_PROGRAM_ADDRESS), byProgram(TOKEN_2022)])
  ).flat();
  const unparsed = entries.flatMap(({ entry }) => {
    if (parsedTokenOf(entry.account.data)) return [];
    const read = rawTokenOf(entry.account.data);
    return read ? [read.mint] : [];
  });
  const mints = [...new Set(unparsed)];
  const decimalsOf = new Map<Address, number>();
  if (mints.length > 0) {
    const read = await readAccounts(client, mints, { offset: DECIMALS_AT, length: 1 });
    mints.forEach((mint, at) => {
      const byte = read[at]?.[0];
      if (byte !== undefined) decimalsOf.set(mint, byte);
    });
  }
  return entries.flatMap(({ entry, programId }): PublicToken[] => {
    const parsed = parsedTokenOf(entry.account.data);
    const raw = parsed ? null : rawTokenOf(entry.account.data);
    const mint = parsed ? address(parsed.mint) : raw?.mint;
    const decimals = parsed ? parsed.decimals : mint ? decimalsOf.get(mint) : undefined;
    const read = parsed ?? raw;
    if (!read || !mint || decimals === undefined) return [];
    return [
      {
        mint,
        account: entry.pubkey,
        program: programId,
        amount: read.amount,
        decimals,
        rent: BigInt(entry.account.lamports),
        frozen: read.frozen,
        wrapped: isWrappedSol(mint, programId),
      },
    ];
  });
}

export async function publicMoneyOf(
  client: Pick<SprClient, "solanaRpc">,
  owner: Address,
): Promise<PublicMoney> {
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
