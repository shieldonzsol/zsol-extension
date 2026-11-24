import { LockIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { lock } from "@/features/session/session-store";

import { useBusy } from "./busy";

export function LockButton() {
  // Locking forgets the wallet: a send being signed or sent finishes first.
  const busy = useBusy();
  const label = busy ? "Lock opens once the send in progress is done." : "Lock zSol";
  return (
    <button
      type="button"
      disabled={busy}
      aria-label={label}
      title={label}
      onClick={() => void lock("manual")}
      className={buttonVariants({ variant: "ghost", size: "sm", className: "gap-1.5" })}
    >
      <LockIcon className="size-3.5" strokeWidth={1.75} />
      Lock
    </button>
  );
}
