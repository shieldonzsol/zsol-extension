import type { ReactNode } from "react";

export function PanelHeader({ end }: { readonly end?: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4">
      <div className="flex min-w-0 items-center gap-2">
        <img src="/icon/32.png" alt="" width={22} height={22} className="rounded-[6px]" />
        <span className="font-display text-[15px] font-semibold tracking-tight">zSol</span>
      </div>
      {end}
    </header>
  );
}
