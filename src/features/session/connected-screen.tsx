import { buttonVariants } from "@/components/ui/button";

import { disconnect, retrySignIn, type SignIn } from "./session-store";

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

const SIGN_IN_WORDS: Record<SignIn, string> = {
  "signing-in": "Signing in to zSol…",
  "signed-in": "Signed in to zSol.",
  failed: "The panel couldn't sign in to zSol. Your account is still connected.",
};

export function ConnectedScreen({
  wallet,
  signIn,
}: {
  readonly wallet: string;
  readonly signIn: SignIn;
}) {
  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex flex-col gap-2">
        <h1 className="headline text-2xl">Connected</h1>
        <p className="text-sm text-pretty text-muted-foreground">
          This panel holds the zSol account of the wallet below, in memory only. Closing the panel
          or Disconnect forgets it.
        </p>
      </div>
      <section
        aria-label="Account"
        className="flex flex-col gap-1 rounded-[10px] border border-border bg-card p-4"
      >
        <span className="text-label text-muted-foreground">Sign-in wallet</span>
        <span className="font-mono text-base" title={wallet}>
          {short(wallet)}
        </span>
      </section>
      <div className="flex flex-col gap-2">
        <output className="text-sm text-pretty">{SIGN_IN_WORDS[signIn]}</output>
        {signIn === "failed" ? (
          <button
            type="button"
            onClick={retrySignIn}
            className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
          >
            Try signing in again
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => void disconnect()}
        className={buttonVariants({ variant: "outline", size: "lg", className: "h-10 w-full" })}
      >
        Disconnect
      </button>
    </div>
  );
}
