import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { ProblemLine } from "@/features/action/parts";

/** Whether the last copy worked: "copied" for a moment, or failed until the next try. */
export function useCopied(): [boolean, () => void, boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return [copied, () => setCopied(true), failed, () => setFailed(true)];
}

/** A link in full, on one line, and a button that copies it. */
export function CopyLine({ value, label }: { readonly value: string; readonly label: string }) {
  const [copied, onCopied, failed, onFailed] = useCopied();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-label" title={value} translate="no">
          {value}
        </span>
        <button
          type="button"
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          aria-label={copied ? "Copied" : label}
          title={copied ? "Copied" : label}
          onClick={() => void navigator.clipboard.writeText(value).then(onCopied, onFailed)}
        >
          {copied ? <CheckIcon strokeWidth={1.75} /> : <CopyIcon strokeWidth={1.75} />}
        </button>
      </div>
      {failed ? <ProblemLine text="Not copied: try again." /> : null}
    </div>
  );
}
