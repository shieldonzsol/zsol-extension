import { ZSOL_URL } from "../../src/manifest";

export function App() {
  return (
    <main className="flex min-h-dvh flex-col gap-6 bg-background p-4 text-foreground">
      <header className="flex items-center gap-2.5">
        <img src="/icon/48.png" alt="" width={28} height={28} className="rounded-[7px]" />
        <span className="text-base font-semibold">zSol</span>
      </header>
      <section className="flex flex-col gap-2">
        <h1 className="text-xl leading-tight font-semibold text-balance">
          Your private Solana wallet, beside every chart.
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          This panel is being built. Until it opens your wallet here, zSol runs at zsol.cc.
        </p>
      </section>
      <a
        href={ZSOL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-10 items-center justify-center rounded-[7px] bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Open zsol.cc
      </a>
    </main>
  );
}
