// The account check at unlock: zSol records this private wallet for the signed-in account and
// screens it, on the wallet's own signature of a statement naming that account.
import type { ShieldedKeypair } from "@heliuslabs/spr";
import { getBase58Decoder } from "@solana/kit";

import { siteCall } from "./site-api";
import { privateWalletStatement } from "./statement";

export type AccountCheck = "ok" | "signed-out" | "sanctioned" | "taken" | "refused";

const CHECKS = new Set<string>(["ok", "signed-out", "sanctioned", "taken", "refused"]);
const isCheck = (value: unknown): value is AccountCheck =>
  typeof value === "string" && CHECKS.has(value);

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null
    ? Object.fromEntries(Object.entries(body))[name]
    : undefined;
}

export async function checkAccount(site: string, keypair: ShieldedKeypair): Promise<AccountCheck> {
  const challenge = await siteCall(site, "/api/account/unlock");
  const account = field(challenge, "account");
  const at = field(challenge, "at");
  if (typeof account !== "string" || typeof at !== "number") return "refused";
  const base58 = getBase58Decoder();
  const wallet = keypair.shieldedAddress().solanaAddress();
  const shielded = base58.decode(keypair.shieldedAddress().toBytes());
  const signature = base58.decode(
    keypair.sign(privateWalletStatement({ account, wallet, shielded, at })),
  );
  const answer = await siteCall(site, "/api/account/unlock", {
    method: "POST",
    body: { privateWallet: wallet, at, signature, shielded },
  });
  const check = field(answer, "check");
  return isCheck(check) ? check : "refused";
}
