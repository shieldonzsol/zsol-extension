import { encodeTransactInstructionData, InstructionTag } from "@heliuslabs/spr/interface";
import { describe, expect, it } from "vitest";

import { decodeTransact } from "./transact";

const bytes = (length: number, fill: number) => new Uint8Array(length).fill(fill);

type TransactData = Parameters<typeof encodeTransactInstructionData>[0];

// Fixed-size byte arrays are branded by the SDK; plain ones stand in for them here.
function instruction(outputs: unknown) {
  const data = {
    expiryUnixTs: 0xffffffffffffffffn,
    txViewingPk: bytes(33, 4),
    salt: bytes(16, 6),
    interfaceTransfers: [
      { kind: "solWithdrawal", amount: 1_000_000n },
      { kind: "splDeposit", amount: 42n, splInterfaceBump: 254 },
    ],
    outputs,
    messages: [{ viewTag: bytes(32, 9), data: bytes(5, 8) }],
    privateTxHash: bytes(32, 1),
    circuit: { kind: "confidentialSigner", inputs: 2, outputs: 4, publicAssetSlots: 3 },
    proof: { a: bytes(32, 2), b: bytes(128, 3), c: bytes(32, 4) },
    inputs: [{ nullifierHash: bytes(32, 5), treeIndex: 0 }],
    treeContexts: [{ utxoTreeRootIndex: 7, nullifierTreeRootIndex: 9 }],
  } as unknown as TransactData;
  return Uint8Array.from([InstructionTag.transact, ...encodeTransactInstructionData(data)]);
}

describe("a Rings transact instruction", () => {
  it("reads back what the SDK's encoder wrote", () => {
    const outputs = [
      {
        utxoHash: bytes(32, 21),
        ownerTag: { kind: "account" as const, index: 0 },
        data: bytes(89, 31),
      },
      { utxoHash: bytes(32, 22), ownerTag: { kind: "inline" as const, value: bytes(32, 41) } },
    ];
    const view = decodeTransact(instruction(outputs));
    expect(view.expiryUnixTs).toBe(0xffffffffffffffffn);
    expect(view.txViewingPublicKey).toEqual(bytes(33, 4));
    expect(view.salt).toEqual(bytes(16, 6));
    expect(view.publicLegs).toEqual([
      { kind: "solWithdrawal", amount: 1_000_000n },
      { kind: "splDeposit", amount: 42n },
    ]);
    expect(view.outputs).toEqual(outputs);
  });

  it("refuses another instruction and a cut-off one", () => {
    expect(() => decodeTransact(Uint8Array.from([InstructionTag.deposit, 0]))).toThrow(
      expect.objectContaining({ code: "not-transact" }),
    );
    expect(() => decodeTransact(Uint8Array.from([InstructionTag.transact, 1, 2]))).toThrow(
      expect.objectContaining({ code: "truncated" }),
    );
  });
});
