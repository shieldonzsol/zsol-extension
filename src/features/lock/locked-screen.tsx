import { FingerprintIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { ConnectScreen } from "@/features/pairing/connect-screen";
import { usePairing } from "@/features/pairing/use-pairing";
import { disconnect, unlockWithPasskey } from "@/features/session/session-store";

import { lockAfterWords, type LockReason } from "./lock-rules";
import { PasskeyError } from "./passkey";
import { UNLOCK_FAILURE } from "./passkey-words";
import { useLockAfter } from "./use-lock-after";

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

export function LockedScreen({
  wallet,
  passkey,
  reason,
}: {
  readonly wallet: string;
  readonly passkey: boolean;
  readonly reason: LockReason | null;
}) {
  const [connecting, setConnecting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [failed, setFailed] = useState<PasskeyError["code"] | null>(null);
  const lockAfter = useLockAfter();

  if (connecting) {
    return (
      <div className="flex flex-col">
        <PairingAgain />
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={() => setConnecting(false)}
            className={buttonVariants({ variant: "outline", size: "lg", className: "h-10 w-full" })}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const why =
    reason === "idle"
      ? `Locked after ${lockAfterWords(lockAfter)} with nobody using it.`
      : reason === "screen"
        ? "Locked when your computer locked."
        : reason === "manual"
          ? "You locked it."
          : "Chrome forgets the open wallet when it restarts or zSol updates.";

  const unlock = () => {
    setUnlocking(true);
    setFailed(null);
    unlockWithPasskey().then(
      () => setUnlocking(false),
      (error: unknown) => {
        setUnlocking(false);
        setFailed(error instanceof PasskeyError ? error.code : "unsupported");
      },
    );
  };

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex flex-col gap-2">
        <h1 className="headline text-2xl">zSol is locked</h1>
        <p className="text-sm text-pretty text-muted-foreground">{why}</p>
      </div>
      <section
        aria-label="Account"
        className="flex flex-col gap-1 rounded-[10px] border border-border bg-card p-4"
      >
        <span className="text-label text-muted-foreground">Sign-in wallet</span>
        <span className="font-mono text-base" title={wallet} translate="no">
          {short(wallet)}
        </span>
      </section>
      {failed ? (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-sm font-medium text-pretty">{UNLOCK_FAILURE[failed].title}</p>
          <p className="text-label text-pretty text-muted-foreground">
            {UNLOCK_FAILURE[failed].body}
          </p>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        {passkey ? (
          <button
            type="button"
            disabled={unlocking}
            onClick={unlock}
            className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
          >
            {unlocking ? (
              <>
                <LoaderCircleIcon className="animate-spin" strokeWidth={1.75} />
                Waiting for your passkey…
              </>
            ) : (
              <>
                <FingerprintIcon strokeWidth={1.75} />
                Unlock with passkey
              </>
            )}
          </button>
        ) : (
          <p className="text-label text-pretty text-muted-foreground">
            Open zsol.cc and type the code the panel shows. Turn on passkey unlock once it's open,
            to skip this next time.
          </p>
        )}
        <button
          type="button"
          disabled={unlocking}
          onClick={() => setConnecting(true)}
          className={buttonVariants({
            variant: passkey ? "outline" : "default",
            size: "lg",
            className: "h-10 w-full",
          })}
        >
          Connect with a code
        </button>
      </div>
      <button
        type="button"
        disabled={unlocking}
        onClick={() => void disconnect()}
        className={buttonVariants({ variant: "ghost", size: "sm", className: "self-center" })}
      >
        Forget this account in the panel
      </button>
    </div>
  );
}

// Listens for zsol.cc only while the code is on screen.
function PairingAgain() {
  usePairing();
  return <ConnectScreen />;
}
