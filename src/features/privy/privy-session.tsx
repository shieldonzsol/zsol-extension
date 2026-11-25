import { PrivyProvider, useIdentityToken, useLoginWithSiws, usePrivy } from "@privy-io/react-auth";
import { useEffect, type ReactNode } from "react";

import { PRIVY_APP_ID } from "@/config";
import { authHeaders, setIdentityToken } from "@/features/privy/auth-headers";
import { siwsMessage } from "@/features/privy/siws";
import { extensionKey } from "@/features/session/extension-key";
import { onSignOut, setSignIn, type SignIn } from "@/features/session/session-store";

// zsol.cc links this key with the same connector type, which keeps it out of the person's
// sign-in wallets.
const APP_KEY_CONNECTOR = "app_key";

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

// One sign-in at a time: a second one for the same address would replace the first one's nonce.
let flight: Promise<SignIn> | null = null;

function once(run: () => Promise<SignIn>): Promise<SignIn> {
  if (flight === null) {
    flight = run().finally(() => {
      flight = null;
    });
  }
  return flight;
}

export default function PrivySession({
  seed,
  attempt,
  children,
}: {
  readonly seed: Uint8Array;
  readonly attempt: number;
  readonly children: ReactNode;
}) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["wallet"],
        appearance: { walletChainType: "solana-only" },
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
      }}
    >
      {/* A retry mounts a fresh attempt. */}
      <SignInWithKey key={attempt} seed={seed} />
      <KeepIdentityToken />
      {children}
    </PrivyProvider>
  );
}

/** How often an open panel renews the sign-in it keeps for the overlay. */
const RENEW_MS = 4 * 60_000;

function KeepIdentityToken() {
  const { identityToken } = useIdentityToken();
  useEffect(() => {
    setIdentityToken(identityToken);
    void authHeaders().catch(() => undefined);
    const renew = setInterval(() => void authHeaders().catch(() => undefined), RENEW_MS);
    return () => {
      clearInterval(renew);
      setIdentityToken(null);
    };
  }, [identityToken]);
  return null;
}

function SignInWithKey({ seed }: { readonly seed: Uint8Array }) {
  const { ready, authenticated, user, logout } = usePrivy();
  const { generateSiwsMessage, loginWithSiws } = useLoginWithSiws();

  useEffect(() => {
    onSignOut(logout);
    return () => onSignOut(null);
  }, [logout]);

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    const run = async (): Promise<SignIn> => {
      const key = await extensionKey(seed);
      const ours = user?.linkedAccounts.some(
        (account) => account.type === "wallet" && account.address === key.address,
      );
      if (authenticated && ours) return "signed-in";
      if (authenticated) await logout();
      const generated = await generateSiwsMessage({ address: key.address });
      const nonce = /^Nonce: (\S+)$/m.exec(generated)?.[1];
      if (!nonce) throw new Error("Privy's message carried no nonce.");
      const message = siwsMessage(key.address, nonce, new Date());
      const signature = await key.sign(new TextEncoder().encode(message));
      await loginWithSiws({
        message,
        signature: base64(signature),
        walletClientType: "unknown",
        connectorType: APP_KEY_CONNECTOR,
      });
      return "signed-in";
    };
    once(run).then(
      (state) => {
        if (!cancelled) setSignIn(state);
      },
      () => {
        if (!cancelled) setSignIn("failed");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, user, seed, logout, generateSiwsMessage, loginWithSiws]);

  return null;
}
