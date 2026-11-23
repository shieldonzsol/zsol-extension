import { ZSOL_URL } from "@/manifest";

// Privy accepts only an allowed https domain in the message, not the extension's own origin.
const { host, origin } = new URL(ZSOL_URL);

/** Privy's Sign-In-With-Solana message, for zsol.cc. */
export function siwsMessage(address: string, nonce: string, issuedAt: Date): string {
  return [
    `${host} wants you to sign in with your Solana account:`,
    address,
    "",
    `You are proving you own ${address}.`,
    "",
    `URI: ${origin}`,
    "Version: 1",
    "Chain ID: mainnet",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    "Resources:",
    "- https://privy.io",
  ].join("\n");
}
