import type { ClaimProgress, ClaimStep } from "./claim-run";
import { amountsText, type Shown } from "./links-store";

/** When a link was made, or when its money lands. */
export const LINK_DATE = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const STEP_WORDS: Record<ClaimStep, string> = {
  reading: "Reading the link.",
  proving: "Preparing it.",
  signing: "Signing it in this panel.",
  sending: "zSol checks it and sends it.",
  confirming: "Waiting for it to land.",
  syncing: "Reading your balance.",
};

/** Where a claim is: its step, and which move of how many. */
export function ClaimWords({ progress }: { readonly progress: ClaimProgress | null }) {
  if (!progress) return null;
  const words = STEP_WORDS[progress.step];
  return (
    <span>
      {progress.moves > 1
        ? `Part ${String(progress.move)} of ${String(progress.moves)}: ${words}`
        : words}
    </span>
  );
}

/** What moved before a claim stopped, when anything did. */
export function MovedLine({ moved }: { readonly moved: readonly Shown[] }) {
  if (moved.length === 0) return null;
  return (
    <p className="text-label text-pretty">
      Moved before it stopped: {amountsText(moved)}, now in your private balance. Moving the rest
      takes only what is left.
    </p>
  );
}
