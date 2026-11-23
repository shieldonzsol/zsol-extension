import { buttonVariants } from "@/components/ui/button";

import { disconnect } from "./session-store";

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

export function ConnectedScreen({ wallet }: { readonly wallet: string }) {
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
      <button
        type="button"
        onClick={disconnect}
        className={buttonVariants({ variant: "outline", size: "lg", className: "h-10 w-full" })}
      >
        Disconnect
      </button>
    </div>
  );
}
