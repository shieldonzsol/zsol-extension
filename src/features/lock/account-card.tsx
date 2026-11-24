import { useEffect, useId, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { disconnect, turnOffPasskey, turnOnPasskey } from "@/features/session/session-store";

import { useBusy } from "./busy";
import { LOCK_AFTER_CHOICES, lockAfterOf, lockAfterWords } from "./lock-rules";
import { PasskeyError, passkeysUsable } from "./passkey";
import { SAVE_FAILURE } from "./passkey-words";
import { useLockAfter } from "./use-lock-after";
import { writeLockAfter } from "./vault";

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/** The account in the panel: who it is, when it locks, passkey unlock, and Disconnect. */
export function AccountCard({
  signInWallet,
  passkey,
}: {
  readonly signInWallet: string;
  readonly passkey: boolean;
}) {
  const busy = useBusy();
  const lockAfter = useLockAfter();
  const lockId = useId();
  const [usable, setUsable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void passkeysUsable().then((value) => {
      if (live) setUsable(value);
    });
    return () => {
      live = false;
    };
  }, []);

  const turnOn = () => {
    setSaving(true);
    setFailed(null);
    turnOnPasskey().then(
      () => setSaving(false),
      (error: unknown) => {
        setSaving(false);
        setFailed(SAVE_FAILURE[error instanceof PasskeyError ? error.code : "unsupported"]);
      },
    );
  };

  return (
    <section
      aria-label="Account"
      className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-4 text-label"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Signed in with</span>
        <span className="font-mono text-foreground" title={signInWallet} translate="no">
          {short(signInWallet)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={lockId} className="text-muted-foreground">
          Locks after
        </label>
        <select
          id={lockId}
          value={lockAfter}
          onChange={(event) => void writeLockAfter(lockAfterOf(Number(event.target.value)))}
          className="h-7 rounded-md border border-input bg-transparent px-2 text-label text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {LOCK_AFTER_CHOICES.map((minutes) => (
            <option key={minutes} value={minutes}>
              {lockAfterWords(minutes)} unused
            </option>
          ))}
        </select>
      </div>
      {passkey || usable ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Passkey unlock</span>
          {passkey ? (
            <span className="flex items-center gap-1">
              <span className="text-foreground">On</span>
              <button
                type="button"
                onClick={() => void turnOffPasskey()}
                className={buttonVariants({ variant: "ghost", size: "xs" })}
              >
                Turn off
              </button>
            </span>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={turnOn}
              className={buttonVariants({ variant: "outline", size: "xs" })}
            >
              {saving ? "Waiting for your passkey…" : "Turn on"}
            </button>
          )}
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="text-pretty">
          {failed}
        </p>
      ) : null}
      <div className="flex justify-end border-t border-border/70 pt-3">
        <button
          type="button"
          disabled={busy}
          title={busy ? "Disconnect opens once the send in progress is done." : undefined}
          onClick={() => void disconnect()}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Disconnect
        </button>
      </div>
    </section>
  );
}
