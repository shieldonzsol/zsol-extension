import type * as Spr from "@heliuslabs/spr";
import { getSplAssetRegistryAddress } from "@heliuslabs/spr/addresses";
import type * as SprInstructions from "@heliuslabs/spr/instructions";
import type * as SprWallet from "@heliuslabs/spr/wallet";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  decompileTransactionMessage,
  getAddressDecoder,
  getAddressEncoder,
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  isTransactionWithinSizeLimit,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type Transaction,
  type V1TransactionConfig,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSweep,
  failedInstructionOf,
  MAX_COMPUTE_UNITS,
  overCapacity,
  overflowOf,
  publicMoneyOf,
  rawTokenOf,
  stayingOf,
  sweepComputeLimit,
  sweepFlow,
  sweepSplit,
  SweepShortOfRent,
  SweepTooSmall,
  SweepWouldFail,
  type PublicToken,
  type Sweep,
  type SweepOwner,
  type SweepPart,
} from "./sweep";

const sdk = vi.hoisted(() => ({
  registered: true,
  deposits: [] as {
    asset: string;
    amount: bigint;
    splTokenAccount?: string;
    createSplInterface?: boolean;
  }[],
}));

vi.mock("@heliuslabs/spr", async (original) => {
  const real = await original<typeof Spr>();
  return {
    ...real,
    // One instruction a deposit, naming its asset and the account it draws from.
    buildDepositTransaction: (input: {
      feePayer: Address;
      asset: Address;
      amount: bigint;
      splTokenAccount?: Address;
      createSplInterface?: boolean;
    }) => {
      sdk.deposits.push({
        asset: input.asset,
        amount: input.amount,
        ...(input.splTokenAccount === undefined ? {} : { splTokenAccount: input.splTokenAccount }),
        ...(input.createSplInterface === undefined
          ? {}
          : { createSplInterface: input.createSplInterface }),
      });
      return Promise.resolve(
        compiled(input.feePayer, [depositOf(input.asset, input.splTokenAccount)]),
      );
    },
  };
});
vi.mock("@heliuslabs/spr/wallet", async (original) => ({
  ...(await original<typeof SprWallet>()),
  isWalletRegistered: () => Promise.resolve(sdk.registered),
}));
vi.mock("@heliuslabs/spr/instructions", async (original) => ({
  ...(await original<typeof SprInstructions>()),
  getRegisterInstructionAsync: () =>
    Promise.resolve({
      programAddress: REGISTRY,
      accounts: [{ address: TRADER, role: AccountRole.WRITABLE_SIGNER }],
      data: new Uint8Array([0]),
    }),
}));

const made = (n: number): Address => {
  const bytes = new Uint8Array(32);
  bytes[0] = n % 256;
  bytes[1] = Math.floor(n / 256);
  bytes[31] = 9;
  return getAddressDecoder().decode(bytes);
};

const TRADER = made(1);
const FEE_WALLET = made(2);
const DEPOSIT_PROGRAM = made(3);
const REGISTRY = made(5);
const LIFETIME = { blockhash: made(4) as string as Blockhash, lastValidBlockHeight: 9n };
const SOL = "11111111111111111111111111111111";
const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const WRAPPED_SOL = address("So11111111111111111111111111111111111111112");
const WRAPPED_SOL_2022 = address("9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP");
const USDC = made(10);
const SPAM = made(11);
const ICED = made(12);
const BAD = made(13);
const EXT = made(14);
const RESERVE = 890_880n;
const RECORD = 1_586_880n;
const RENT = 2_039_280n;
const PRIORITY = 10_000n;
const SELF_FEE = 5_000n + PRIORITY;
const FRONTED_FEE = 10_000n + PRIORITY;

function depositOf(asset: Address, from?: Address): Instruction {
  return {
    programAddress: DEPOSIT_PROGRAM,
    accounts: [
      { address: asset, role: AccountRole.READONLY },
      ...(from ? [{ address: from, role: AccountRole.WRITABLE }] : []),
    ],
    data: new Uint8Array([1]),
  };
}

const sends = <T>(value: T) => ({ send: () => Promise.resolve(value) });

function compiled(feePayer: Address, instructions: readonly Instruction[]) {
  return compileTransaction(
    pipe(
      createTransactionMessage({ version: 1 }),
      (message) => setTransactionMessageFeePayer(feePayer, message),
      (message) => setTransactionMessageLifetimeUsingBlockhash(LIFETIME, message),
      (message) => appendTransactionMessageInstructions(instructions, message),
    ),
  );
}

const instructionsOf = (transaction: Transaction) =>
  decompileTransactionMessage(
    getCompiledTransactionMessageDecoder().decode(transaction.messageBytes),
  ).instructions;

interface Held {
  readonly mint: Address;
  readonly account: Address;
  readonly amount: bigint;
  readonly rent?: bigint;
  readonly frozen?: boolean;
  readonly program?: Address;
}

const keypair = {
  shieldedAddress: () => ({ solanaAddress: () => TRADER }),
  nullifierPublicKey: () => new Uint8Array(32),
  viewingPublicKey: () => ({ toBytes: () => new Uint8Array(32) }),
} as unknown as Parameters<typeof buildSweep>[1]["keypair"];

interface Simulated {
  readonly err: unknown;
  readonly unitsConsumed?: bigint;
}

/** A chain where the address holds `lamports` and `held`, Rings knows `known`, and `judge` runs each simulation. */
function chainOf(input: {
  lamports: bigint;
  held: readonly Held[];
  known: readonly Address[];
  judge?: (instructions: readonly Instruction[]) => Simulated | null;
  fee?: () => bigint;
}) {
  const simulated: (readonly Instruction[])[] = [];
  const reads: (readonly Address[])[] = [];
  const registries = Promise.all(input.known.map((mint) => getSplAssetRegistryAddress(mint)));
  const client = {
    solanaRpc: {
      getBalance: () => sends({ value: input.lamports }),
      getMinimumBalanceForRentExemption: (space: bigint) => sends(space === 0n ? RESERVE : RECORD),
      getTokenAccountsByOwner: (_: Address, filter: { programId: Address }) =>
        sends({
          value: input.held
            .filter((each) => (each.program ?? TOKEN_PROGRAM_ADDRESS) === filter.programId)
            .map((each) => ({
              pubkey: each.account,
              account: {
                lamports: each.rent ?? RENT,
                data: {
                  parsed: {
                    info: {
                      mint: each.mint,
                      state: each.frozen ? "frozen" : "initialized",
                      tokenAmount: { amount: each.amount.toString(), decimals: 6 },
                    },
                  },
                },
              },
            })),
        }),
      getMultipleAccounts: (asked: readonly Address[]) => ({
        send: async () => {
          reads.push(asked);
          const known = await registries;
          return {
            value: asked.map((each) =>
              known.includes(each) ? { data: ["AQIDBAUGBwg=", "base64"] } : null,
            ),
          };
        },
      }),
      getLatestBlockhash: () => sends({ value: LIFETIME }),
      getFeeForMessage: (message: string) => {
        const { numSignerAccounts } = getCompiledTransactionMessageDecoder().decode(
          getBase64Encoder().encode(message),
        ).header;
        return sends({ value: input.fee?.() ?? 5_000n * BigInt(numSignerAccounts) + PRIORITY });
      },
      simulateTransaction: (wire: string) => {
        const instructions = instructionsOf(
          getTransactionDecoder().decode(getBase64Encoder().encode(wire)),
        );
        simulated.push(instructions);
        const judged = input.judge?.(instructions) ?? null;
        return sends({
          value: { err: judged?.err ?? null, unitsConsumed: judged?.unitsConsumed ?? 300_000n },
        });
      },
    },
  } as unknown as Parameters<typeof buildSweep>[0];
  return { client, simulated, reads };
}

/** A new wallet's address holding only an empty wrapped SOL account with this many lamports. */
const onlyWrappedSol = (rent: bigint) =>
  chainOf({
    lamports: 0n,
    held: [{ mint: WRAPPED_SOL, account: made(24), amount: 0n, rent }],
    known: [],
  }).client;

const closeOf = (instructions: readonly Instruction[], account: Address) =>
  instructions.findIndex(
    (instruction) => instruction.data?.[0] === 9 && instruction.accounts?.[0]?.address === account,
  );

const depositsIn = (instructions: readonly Instruction[]) =>
  instructions
    .filter((instruction) => instruction.programAddress === DEPOSIT_PROGRAM)
    .map((instruction) => instruction.accounts![0]!.address);

const depositAt = (instructions: readonly Instruction[], asset: string) =>
  instructions.findIndex(
    (instruction) =>
      instruction.programAddress === DEPOSIT_PROGRAM &&
      instruction.accounts?.[0]?.address === asset,
  );

const configOf = (transaction: Transaction) =>
  (
    decompileTransactionMessage(
      getCompiledTransactionMessageDecoder().decode(transaction.messageBytes),
    ) as { readonly config?: V1TransactionConfig }
  ).config ?? {};

const feePayerOf = (transaction: Transaction) =>
  getCompiledTransactionMessageDecoder().decode(transaction.messageBytes).staticAccounts[0];

const build = (client: Parameters<typeof buildSweep>[0]) =>
  buildSweep(client, { keypair, feePayer: FEE_WALLET });

const built = async (client: Parameters<typeof buildSweep>[0]): Promise<Sweep> => {
  const sweep = await build(client);
  if ("nothing" in sweep) throw new Error("Nothing moved.");
  return sweep;
};

beforeEach(() => {
  sdk.deposits.length = 0;
  sdk.registered = true;
});

describe("building Move to private", () => {
  it("leaves new and frozen tokens out, unwraps SOL, and drops a token whose deposit fails", async () => {
    const wrapped = 1_000_000n;
    const { client, simulated } = chainOf({
      lamports: 10_000_000n,
      held: [
        { mint: USDC, account: made(20), amount: 5n },
        { mint: SPAM, account: made(21), amount: 1_000n },
        { mint: ICED, account: made(22), amount: 7n, frozen: true },
        { mint: BAD, account: made(23), amount: 3n },
        { mint: WRAPPED_SOL, account: made(24), amount: wrapped, rent: RENT + wrapped },
      ],
      known: [USDC, ICED, BAD],
      judge: (instructions) => {
        const at = depositAt(instructions, BAD);
        return at < 0 ? null : { err: { InstructionError: [at, { Custom: 1 }] } };
      },
    });
    const sweep = await built(client);

    expect(simulated).toHaveLength(2);
    expect(sweep.staying.map(({ token, why }) => [token.account, why])).toEqual([
      [made(22), "frozen"],
      [made(21), "new-to-rings"],
      [made(23), "fails"],
    ]);
    expect(sweep.moved.map((token) => token.mint)).toEqual([USDC]);
    const sent = instructionsOf(sweep.transaction);
    expect(depositsIn(sent)).toEqual([USDC, SOL]);
    expect(closeOf(sent, made(20))).toBeGreaterThan(depositAt(sent, USDC));
    expect(closeOf(sent, made(24))).toBeGreaterThanOrEqual(0);
    for (const kept of [made(21), made(22), made(23)]) expect(closeOf(sent, kept)).toBe(-1);
    const tokenDeposits = sdk.deposits.filter((each) => each.asset !== SOL);
    expect(tokenDeposits.every((each) => each.createSplInterface === false)).toBe(true);
    expect(tokenDeposits.every((each) => each.splTokenAccount !== undefined)).toBe(true);
    expect(sdk.deposits.some((each) => each.asset === SPAM || each.asset === ICED)).toBe(false);
    expect(feePayerOf(sweep.transaction)).toBe(TRADER);
    expect(sweep.networkFee).toBe(SELF_FEE);
    expect(sweep.sol).toBe(10_000_000n + RENT + RENT + wrapped - SELF_FEE);
    expect(sweep.unwrapped).toBe(wrapped);
    expect(sweep).toMatchObject({ closes: 1, closedRent: RENT });
    expect(configOf(sweep.transaction).computeUnitLimit).toBe(sweepComputeLimit(300_000n));
  });

  it("deposits each account of one mint from that account", async () => {
    const { client } = chainOf({
      lamports: 10_000_000n,
      held: [
        { mint: USDC, account: made(20), amount: 5n },
        { mint: USDC, account: made(25), amount: 9n },
      ],
      known: [USDC],
    });
    const sweep = await built(client);
    expect(
      sdk.deposits
        .filter((each) => each.asset === USDC)
        .map((each) => [each.splTokenAccount, each.amount]),
    ).toEqual([
      [made(20), 5n],
      [made(25), 9n],
    ]);
    expect(sweep.moved).toHaveLength(2);
  });

  it("keeps an account open when only its closing fails, and still deposits its token", async () => {
    const { client } = chainOf({
      lamports: 10_000_000n,
      held: [{ mint: USDC, account: made(20), amount: 5n }],
      known: [USDC],
      judge: (instructions) => {
        const at = closeOf(instructions, made(20));
        return at < 0 ? null : { err: { InstructionError: [at, { Custom: 11 }] } };
      },
    });
    const sweep = await built(client);
    const sent = instructionsOf(sweep.transaction);
    expect(depositsIn(sent)).toEqual([USDC, SOL]);
    expect(closeOf(sent, made(20))).toBe(-1);
    expect(sweep.staying).toEqual([]);
    expect(sweep).toMatchObject({ closes: 0, closedRent: 0n, sol: 10_000_000n - SELF_FEE });
  });

  it("closes empty Token-2022 accounts with Token-2022, and unwraps both kinds of wrapped SOL", async () => {
    const { client } = chainOf({
      lamports: 10_000_000n,
      held: [
        { mint: EXT, account: made(30), amount: 0n, program: TOKEN_2022, rent: 2_500_000n },
        {
          mint: WRAPPED_SOL_2022,
          account: made(31),
          amount: 4n,
          program: TOKEN_2022,
          rent: RENT + 4n,
        },
        { mint: WRAPPED_SOL, account: made(32), amount: 6n, rent: RENT + 6n },
      ],
      known: [],
    });
    const sweep = await built(client);
    const sent = instructionsOf(sweep.transaction);
    expect(sent[closeOf(sent, made(30))]!.programAddress).toBe(TOKEN_2022);
    expect(sent[closeOf(sent, made(31))]!.programAddress).toBe(TOKEN_2022);
    expect(sent[closeOf(sent, made(32))]!.programAddress).toBe(TOKEN_PROGRAM_ADDRESS);
    expect(depositsIn(sent)).toEqual([SOL]);
    expect(sweep.unwrapped).toBe(10n);
    expect(sweep).toMatchObject({ closes: 1, closedRent: 2_500_000n });
    expect(sweep.sol).toBe(10_000_000n + 2_500_000n + RENT + 4n + RENT + 6n - SELF_FEE);
  });

  it("takes what fits one transaction and leaves the rest for the next move", async () => {
    const held = Array.from({ length: 40 }, (_, n) => ({
      mint: made(100 + n),
      account: made(200 + n),
      amount: BigInt(n + 1),
    }));
    const { client } = chainOf({
      lamports: 10_000_000n,
      held,
      known: held.map((each) => each.mint),
    });
    const sweep = await built(client);
    expect(isTransactionWithinSizeLimit(sweep.transaction)).toBe(true);
    expect(
      getCompiledTransactionMessageDecoder().decode(sweep.transaction.messageBytes).staticAccounts
        .length,
    ).toBeLessThanOrEqual(64);
    const later = sweep.staying.filter(({ why }) => why === "later");
    expect(later.length).toBeGreaterThan(0);
    expect(sweep.moved.length + later.length).toBe(40);
    expect(sweep.moved[0]!.account).toBe(made(200));
    expect(depositsIn(instructionsOf(sweep.transaction)).at(-1)).toBe(SOL);
  });

  it("leaves the rest for the next move when compute runs out", async () => {
    const held = Array.from({ length: 6 }, (_, n) => ({
      mint: made(100 + n),
      account: made(200 + n),
      amount: 1n,
    }));
    const { client, simulated } = chainOf({
      lamports: 10_000_000n,
      held,
      known: held.map((each) => each.mint),
      judge: (instructions) =>
        depositsIn(instructions).length <= 4
          ? null
          : {
              err: {
                InstructionError: [
                  depositAt(instructions, made(103)),
                  "ComputationalBudgetExceeded",
                ],
              },
              unitsConsumed: BigInt(MAX_COMPUTE_UNITS),
            },
    });
    const sweep = await built(client);
    expect(simulated).toHaveLength(2);
    expect(sweep.moved.map((token) => token.mint)).toEqual([made(100), made(101)]);
    expect(
      sweep.staying.filter(({ why }) => why === "later").map(({ token }) => token.mint),
    ).toEqual([made(102), made(103), made(104), made(105)]);
  });

  it("has zSol front the fee when the address can't pay first, and hands exactly that back", async () => {
    const { client } = chainOf({
      lamports: RESERVE,
      held: [{ mint: USDC, account: made(20), amount: 5n }],
      known: [USDC],
    });
    const sweep = await built(client);
    const sent = instructionsOf(sweep.transaction);
    expect(feePayerOf(sweep.transaction)).toBe(FEE_WALLET);
    const paysBack = sent.filter(
      (instruction) =>
        instruction.programAddress === SOL && instruction.accounts?.[1]?.address === FEE_WALLET,
    );
    expect(paysBack).toHaveLength(1);
    const data = paysBack[0]!.data!;
    expect(new DataView(data.buffer, data.byteOffset + 4, 8).getBigUint64(0, true)).toBe(
      FRONTED_FEE,
    );
    expect(sweep.networkFee).toBe(FRONTED_FEE);
    expect(sweep.sol).toBe(RESERVE + RENT - FRONTED_FEE);
  });

  it("registers a new wallet after the closes that pay for its record", async () => {
    sdk.registered = false;
    const wrapped = 3_000_000n;
    const { client } = chainOf({
      lamports: 0n,
      held: [{ mint: WRAPPED_SOL, account: made(24), amount: wrapped, rent: RENT + wrapped }],
      known: [],
    });
    const sweep = await built(client);
    const sent = instructionsOf(sweep.transaction);
    const register = sent.findIndex((instruction) => instruction.programAddress === REGISTRY);
    expect(closeOf(sent, made(24))).toBeLessThan(register);
    expect(register).toBeLessThan(depositAt(sent, SOL));
    expect(sweep.registryRent).toBe(RECORD);
    expect(feePayerOf(sweep.transaction)).toBe(FEE_WALLET);
    expect(sweep.sol).toBe(RENT + wrapped - RECORD - FRONTED_FEE);
  });

  it("counts what closes bring toward the record's rent, and refuses when it's still short", async () => {
    sdk.registered = false;
    const refused = build(onlyWrappedSol(RECORD + 1_000n));
    await expect(refused).rejects.toBeInstanceOf(SweepShortOfRent);
    await expect(refused).rejects.toMatchObject({
      held: RECORD + 1_000n,
      rent: RECORD + 10_000n + PRIORITY,
    });
    await expect(build(onlyWrappedSol(RENT))).resolves.toMatchObject({ registryRent: RECORD });
  });

  it("refuses before signing when the chain prices the fee above the SOL that moves", async () => {
    sdk.registered = false;
    const { client } = chainOf({
      lamports: RECORD + 20_000n,
      held: [],
      known: [],
      fee: () => 30_000n,
    });
    await expect(build(client)).rejects.toBeInstanceOf(SweepTooSmall);
  });

  it("refuses before signing when the simulation fails at no token's instruction", async () => {
    const { client } = chainOf({
      lamports: 10_000_000n,
      held: [{ mint: USDC, account: made(20), amount: 5n }],
      known: [USDC],
      judge: (instructions) => ({
        err: { InstructionError: [instructions.length - 1, "InvalidAccountData"] },
      }),
    });
    await expect(build(client)).rejects.toBeInstanceOf(SweepWouldFail);
  });

  it("says what stays when nothing can move, and never registers for it", async () => {
    sdk.registered = false;
    const { client, simulated } = chainOf({
      lamports: 0n,
      held: [{ mint: SPAM, account: made(21), amount: 1_000n }],
      known: [],
    });
    const sweep = await build(client);
    expect(sweep).toMatchObject({ nothing: true });
    expect(sweep.staying.map(({ why }) => why)).toEqual(["new-to-rings"]);
    expect(simulated).toHaveLength(0);
    expect(sdk.deposits).toHaveLength(0);
  });
});

const token = (n: number, over: Partial<PublicToken> = {}): PublicToken => ({
  mint: made(100 + n),
  account: made(200 + n),
  program: TOKEN_PROGRAM_ADDRESS,
  amount: 1n,
  decimals: 6,
  rent: RENT,
  frozen: false,
  wrapped: false,
  ...over,
});

describe("what stays before anything is built", () => {
  it("asks once for each mint, and takes a registry with no data as new", async () => {
    const { client, reads } = chainOf({ lamports: 0n, held: [], known: [USDC] });
    const staying = await stayingOf(client, [
      token(1, { mint: USDC }),
      token(2, { mint: USDC }),
      token(3, { mint: SPAM }),
      token(4, { mint: ICED, frozen: true }),
      token(5, { mint: SPAM, amount: 0n }),
      token(6, { mint: WRAPPED_SOL, wrapped: true }),
    ]);
    expect(reads).toEqual([
      [await getSplAssetRegistryAddress(USDC), await getSplAssetRegistryAddress(SPAM)],
    ]);
    expect(staying.map(({ token: each, why }) => [each.account, why])).toEqual([
      [made(204), "frozen"],
      [made(203), "new-to-rings"],
    ]);
  });
});

describe("reading the address's token accounts", () => {
  it("reads an account the node couldn't parse from its bytes, and its mint's decimals", async () => {
    const bytes = new Uint8Array(165);
    bytes.set(getAddressEncoder().encode(USDC), 0);
    new DataView(bytes.buffer).setBigUint64(64, 42n, true);
    bytes[108] = 2;
    expect(rawTokenOf([getBase64Decoder().decode(bytes), "base64"])).toEqual({
      mint: USDC,
      amount: 42n,
      frozen: true,
    });
    const mint = new Uint8Array([9]);
    const client = {
      solanaRpc: {
        getBalance: () => sends({ value: 0n }),
        getMinimumBalanceForRentExemption: () => sends(RESERVE),
        getTokenAccountsByOwner: (_: Address, filter: { programId: Address }) =>
          sends({
            value:
              filter.programId === TOKEN_2022
                ? [
                    {
                      pubkey: made(40),
                      account: {
                        lamports: RENT,
                        data: [getBase64Decoder().decode(bytes), "base64"],
                      },
                    },
                  ]
                : [],
          }),
        getMultipleAccounts: (asked: readonly Address[], config: unknown) => {
          expect(asked).toEqual([USDC]);
          expect(config).toMatchObject({ dataSlice: { offset: 44, length: 1 } });
          return sends({ value: [{ data: [getBase64Decoder().decode(mint), "base64"] }] });
        },
      },
    } as unknown as Parameters<typeof publicMoneyOf>[0];
    const money = await publicMoneyOf(client, TRADER);
    expect(money.tokens).toEqual([
      {
        mint: USDC,
        account: made(40),
        program: TOKEN_2022,
        amount: 42n,
        decimals: 9,
        rent: RENT,
        frozen: true,
        wrapped: false,
      },
    ]);
  });

  it("leaves out what doesn't read as a token account", () => {
    expect(rawTokenOf([getBase64Decoder().decode(new Uint8Array(100)), "base64"])).toBeNull();
    expect(rawTokenOf([getBase64Decoder().decode(new Uint8Array(165)), "base64"])).toBeNull();
    expect(rawTokenOf({ parsed: {} })).toBeNull();
  });
});

describe("who pays a move's network fee", () => {
  it("is the address itself when it keeps its reserve after the fee", () => {
    expect(
      sweepFlow({
        lamports: 10_000_000n,
        reserve: RESERVE,
        registryRent: null,
        closed: 0n,
        selfFee: 15_000n,
      }),
    ).toEqual({ flowing: 10_000_000n, selfPaid: true });
  });

  it("is zSol, paid back, when the fee would take the address below its reserve", () => {
    expect(
      sweepFlow({
        lamports: RESERVE,
        reserve: RESERVE,
        registryRent: null,
        closed: RENT,
        selfFee: 15_000n,
      }),
    ).toEqual({ flowing: RESERVE + RENT, selfPaid: false });
  });

  it("counts the record's rent out and closed accounts' rent in", () => {
    const { flowing } = sweepFlow({
      lamports: 5_000_000n,
      reserve: RESERVE,
      registryRent: RECORD,
      closed: RENT,
      selfFee: 15_000n,
    });
    expect(flowing).toBe(5_000_000n - RECORD + RENT);
  });
});

describe("what a move hands back and puts in", () => {
  it("takes the fee from the SOL when the address pays", () => {
    expect(sweepSplit({ flowing: 1_000_000n, selfPaid: true, fee: 15_000n })).toEqual({
      paysBack: 0n,
      sol: 985_000n,
      paid: 15_000n,
    });
  });

  it("hands zSol back exactly the fee it fronted", () => {
    expect(sweepSplit({ flowing: 1_000_000n, selfPaid: false, fee: 20_000n })).toEqual({
      paysBack: 20_000n,
      sol: 980_000n,
      paid: 20_000n,
    });
  });

  it("refuses SOL smaller than the fee, whoever pays it", () => {
    expect(() => sweepSplit({ flowing: 12_000n, selfPaid: false, fee: 20_000n })).toThrow(
      SweepTooSmall,
    );
    expect(() => sweepSplit({ flowing: 12_000n, selfPaid: true, fee: 20_000n })).toThrow(
      SweepTooSmall,
    );
  });

  it("leaves the fee fronted only when no SOL moves at all", () => {
    expect(sweepSplit({ flowing: 0n, selfPaid: false, fee: 20_000n })).toEqual({
      paysBack: 0n,
      sol: 0n,
      paid: 0n,
    });
  });
});

describe("the instruction a simulation failed at", () => {
  it("reads it as a number or a bigint", () => {
    expect(failedInstructionOf({ InstructionError: [3, { Custom: 1 }] })).toBe(3);
    expect(failedInstructionOf({ InstructionError: [2n, "InvalidAccountData"] })).toBe(2);
  });

  it("is null when the failure names none", () => {
    expect(failedInstructionOf("AccountNotFound")).toBeNull();
    expect(failedInstructionOf({ InsufficientFundsForRent: { account_index: 0 } })).toBeNull();
  });
});

describe("a move too big for one transaction", () => {
  it("is running out of compute, or of accounts to load or lock", () => {
    expect(overCapacity({ InstructionError: [4, "ComputationalBudgetExceeded"] })).toBe(true);
    expect(overCapacity({ InstructionError: [4, "ProgramFailedToComplete"] }, 1_400_000n)).toBe(
      true,
    );
    expect(overCapacity("MaxLoadedAccountsDataSizeExceeded")).toBe(true);
    expect(overCapacity("TooManyAccountLocks")).toBe(true);
  });

  it("is not a token's own failure", () => {
    expect(overCapacity({ InstructionError: [4, { Custom: 1 }] }, 90_000n)).toBe(false);
    expect(overCapacity("AccountNotFound")).toBe(false);
  });

  it("asks for the compute it used with room, never past the chain's most", () => {
    expect(sweepComputeLimit(100_000n)).toBe(140_000);
    expect(sweepComputeLimit(1_300_000n)).toBe(MAX_COMPUTE_UNITS);
    expect(sweepComputeLimit(undefined)).toBe(MAX_COMPUTE_UNITS);
  });

  const parts: SweepPart[] = [
    { token: token(0, { mint: WRAPPED_SOL, wrapped: true }), kind: "unwrap" },
    { token: token(1), kind: "deposit" },
    { token: token(2), kind: "deposit" },
    { token: token(3), kind: "deposit" },
    { token: token(4, { amount: 0n }), kind: "empty" },
  ];
  // As a move lays them out: closes that need no deposit, then each deposit and its close.
  const owners: SweepOwner[] = [
    { token: parts[0]!.token, closes: true },
    { token: parts[4]!.token, closes: true },
    { token: parts[1]!.token, closes: false },
    { token: parts[1]!.token, closes: true },
    { token: parts[2]!.token, closes: false },
    { token: parts[2]!.token, closes: true },
    { token: parts[3]!.token, closes: false },
    { token: parts[3]!.token, closes: true },
    null,
  ];

  it("leaves what hadn't finished, and the last deposit that had, for the SOL", () => {
    expect(overflowOf(parts, owners, 4).map((part) => part.token.account)).toEqual([
      made(201),
      made(202),
      made(203),
    ]);
  });

  it("leaves one deposit when it ran out at the SOL, and always leaves something", () => {
    expect(overflowOf(parts, owners, 8).map((part) => part.token.account)).toEqual([made(203)]);
    expect(overflowOf(parts.slice(0, 1), owners.slice(0, 1), null)).toEqual(parts.slice(0, 1));
  });
});
