import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { ZSOL_URL } from "@/manifest";

import { formatCode } from "./code";
import { renewIfSpent, useTicket } from "./ticket-store";

const CONNECT_URL = `${ZSOL_URL}/extension/connect`;

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function ConnectScreen() {
  const ticket = useTicket();
  const now = useNow();
  const left = Math.max(0, Math.ceil((ticket.expiresAt - now) / 1000));
  const code = formatCode(ticket.code);

  useEffect(() => {
    renewIfSpent(now);
  }, [now]);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex flex-col gap-2">
        <h1 className="headline text-2xl">Connect your zSol account</h1>
        <p className="text-sm text-pretty text-muted-foreground">
          On zsol.cc, in this browser, open Connect extension and type this code. Your wallet asks
          you to approve once.
        </p>
      </div>

      <section
        aria-label="Your code"
        className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-4"
      >
        <span className="text-label text-muted-foreground">Your code</span>
        <div className="flex items-center justify-between gap-3">
          <output
            aria-live="polite"
            className="font-mono text-[28px] leading-none font-medium tracking-[0.12em]"
          >
            {code}
          </output>
          <CopyButton text={code} />
        </div>
        <span className="text-label text-muted-foreground">
          Works once. A new code in {clock(left)}.
        </span>
      </section>

      <a
        href={CONNECT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ size: "lg", className: "h-10 w-full" })}
      >
        Open zsol.cc to connect
      </a>
    </div>
  );
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function CopyButton({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={copied ? "Code copied" : "Copy the code"}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
      className={buttonVariants({ variant: "ghost", size: "icon" })}
    >
      {copied ? (
        <CheckIcon aria-hidden="true" strokeWidth={1.5} className="text-ok" />
      ) : (
        <CopyIcon aria-hidden="true" strokeWidth={1.5} />
      )}
    </button>
  );
}
