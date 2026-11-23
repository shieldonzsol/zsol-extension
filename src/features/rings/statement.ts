/** That this panel holds `wallet` for the signed-in `account`, at `at`: signed by the wallet. */
export function privateWalletStatement(input: {
  readonly account: string;
  readonly wallet: string;
  readonly shielded: string;
  readonly at: number;
}): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    [
      "zSol private wallet v1",
      `account: ${input.account}`,
      `wallet: ${input.wallet}`,
      `shielded: ${input.shielded}`,
      `at: ${String(input.at)}`,
    ].join("\n"),
  );
}
