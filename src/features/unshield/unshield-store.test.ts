import { describe, expect, it } from "vitest";

import { draftProblem } from "./unshield-store";

const SOL = "11111111111111111111111111111111";
const OWN = "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB";
const ANY = "3Dt7hkTp2AKev2KELvZgGrttNiNonwSJSTVGS1Ye1xem";

describe("an Unshield's draft", () => {
  it("takes any public address but the zSol address itself", () => {
    expect(draftProblem({ to: "", mint: SOL, amountText: "1" }, OWN)).toEqual({ kind: "to-empty" });
    expect(draftProblem({ to: "nope", mint: SOL, amountText: "1" }, OWN)).toEqual({
      kind: "bad-address",
    });
    expect(draftProblem({ to: OWN, mint: SOL, amountText: "1" }, OWN)).toEqual({ kind: "own" });
    expect(draftProblem({ to: ANY, mint: SOL, amountText: "0.5" }, OWN)).toBeNull();
  });

  it("reads the amount in the token's decimals", () => {
    expect(draftProblem({ to: ANY, mint: SOL, amountText: "0" }, OWN)).toEqual({
      kind: "amount",
      problem: "zero",
    });
  });
});
