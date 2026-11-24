import { FingerprintIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { turnOnPasskey } from "@/features/session/session-store";

import { PasskeyError, passkeysUsable } from "./passkey";
import { SAVE_FAILURE } from "./passkey-words";
import { declinePasskey, readPasskeyDeclined } from "./vault";

/** Offers passkey unlock once the wallet is open, until it is on, declined or impossible here. */
export function PasskeyOffer({ on }: { readonly on: boolean }) {
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<PasskeyError["code"] | null>(null);

  useEffect(() => {
    if (on) return undefined;
    let live = true;
    void Promise.all([passkeysUsable(), readPasskeyDeclined()]).then(([usable, declined]) => {
      if (live) setShown(usable && !declined);
    });
    return () => {
      live = false;
    };
  }, [on]);

  if (on || !shown) return null;

  const save = () => {
    setSaving(true);
    setFailed(null);
    turnOnPasskey().then(
      () => setSaving(false),
      (error: unknown) => {
        setSaving(false);
        const code = error instanceof PasskeyError ? error.code : "unsupported";
        setFailed(code);
        if (code === "unsupported") void declinePasskey();
      },
    );
  };

  return (
    <section
      aria-labelledby="passkey-offer"
      className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="passkey-offer" className="flex items-center gap-2 text-sm font-medium">
          <FingerprintIcon className="size-4 text-primary" strokeWidth={1.75} />
          Unlock with a passkey next time
        </h2>
        <p className="text-label text-pretty text-muted-foreground">
          Touch ID, Windows Hello or your device's PIN opens zSol in this panel, even after Chrome
          restarts. The key stays on this device.
        </p>
      </div>
      {failed ? (
        <p role="alert" className="text-label text-pretty">
          {SAVE_FAILURE[failed]}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className={buttonVariants({ size: "sm" })}
        >
          {saving ? (
            <>
              <LoaderCircleIcon className="animate-spin" strokeWidth={1.75} />
              Waiting for your passkey…
            </>
          ) : failed === "cancelled" ? (
            "Try again"
          ) : (
            "Turn on"
          )}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setShown(false);
            void declinePasskey();
          }}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Not now
        </button>
      </div>
    </section>
  );
}
