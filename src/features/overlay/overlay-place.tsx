import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { placeHref } from "@/app/places";
import { buttonVariants } from "@/components/ui/button";
import { Card, Heading, ProblemLine } from "@/features/action/parts";
import { plainAmount, readAmount } from "@/features/rings/amount-input";
import { formatAbout } from "@/features/rings/amounts";
import { useWallet } from "@/features/wallet/wallet-store";
import { cn } from "@/lib/utils";

import { sitesOn, turnOff, turnOn } from "./registration";
import {
  DEFAULT_SETTINGS,
  MOST_PER_CLICK,
  MOST_PER_DAY,
  readSettings,
  writeSettings,
  type OverlaySettings,
} from "./settings";
import { OVERLAY_SITES, type OverlaySite } from "./sites";

export function OverlayPlace() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <a
        href={placeHref("trade")}
        className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2 self-start" })}
      >
        <ArrowLeftIcon data-icon="inline-start" strokeWidth={1.75} />
        Trade
      </a>
      <Heading
        title="zSol on your terminal"
        body="A small zSol chip on the sites you turn it on for: one click buys or sells the token on the page from a ghost wallet. Chrome asks you for each site when you turn it on, never before."
      />
      <Sites />
      <SettingsForm />
      <p className="px-1 text-label text-pretty text-muted-foreground">
        The chip trades only while zSol is unlocked, even with this panel closed. Lock zSol and it
        stops. It reads the page's address to know the token, and nothing else of the page.
      </p>
    </div>
  );
}

function Sites() {
  const [on, setOn] = useState<ReadonlySet<string> | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    void sitesOn().then(setOn, () => setOn(new Set()));
  }, []);
  const toggle = async (site: OverlaySite, turnItOn: boolean) => {
    setAsking(site.id);
    setRefused(null);
    try {
      if (turnItOn) {
        if (!(await turnOn(site))) setRefused(site.id);
      } else {
        await turnOff(site);
      }
    } finally {
      setOn(await sitesOn().catch(() => new Set<string>()));
      setAsking(null);
    }
  };
  return (
    <Card>
      <span className="text-label font-medium text-muted-foreground">Sites</span>
      <ul className="flex flex-col divide-y divide-border/70">
        {OVERLAY_SITES.map((site) => {
          const isOn = on?.has(site.id) ?? false;
          return (
            <li key={site.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{site.name}</span>
                <span className="truncate text-label text-muted-foreground">
                  {refused === site.id ? "Chrome wasn't allowed: it stays off." : site.host}
                </span>
              </span>
              <button
                type="button"
                disabled={on === null || asking !== null}
                onClick={() => void toggle(site, !isOn)}
                aria-pressed={isOn}
                className={buttonVariants({ variant: isOn ? "default" : "outline", size: "sm" })}
              >
                {asking === site.id ? "Asking…" : isOn ? "On" : "Turn on"}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

interface Typed {
  readonly ghost: number;
  readonly buys: readonly string[];
  readonly sells: readonly string[];
  readonly perClick: string;
  readonly perDay: string;
  readonly slippageBps: number;
  readonly showBalances: boolean;
}

const typedOf = (settings: OverlaySettings): Typed => ({
  ghost: settings.ghost,
  buys: settings.buys.map((each) => plainAmount(each, 9)),
  sells: settings.sells.map(String),
  perClick: plainAmount(settings.perClick, 9),
  perDay: plainAmount(settings.perDay, 9),
  slippageBps: settings.slippageBps,
  showBalances: settings.showBalances,
});

type Problem = { readonly field: string; readonly words: string };

const solOf = (text: string, field: string, most: bigint): bigint | Problem => {
  const read = readAmount(text, 9);
  if (!read.ok) return { field, words: "Write an amount of SOL, like 0.1." };
  if (read.amount > most) return { field, words: `At most ${plainAmount(most, 9)} SOL.` };
  return read.amount;
};

function settingsOfTyped(typed: Typed): OverlaySettings | Problem {
  const buys: bigint[] = [];
  for (const [at, text] of typed.buys.entries()) {
    if (text.trim() === "") continue;
    const read = solOf(text, `buy-${String(at)}`, MOST_PER_CLICK);
    if (typeof read !== "bigint") return read;
    buys.push(read);
  }
  if (buys.length === 0)
    return { field: "buy-0", words: "Give at least one buy button an amount." };
  const sells: number[] = [];
  for (const [at, text] of typed.sells.entries()) {
    if (text.trim() === "") continue;
    const share = Number(text);
    if (!Number.isInteger(share) || share < 1 || share > 100) {
      return { field: `sell-${String(at)}`, words: "A share from 1 to 100." };
    }
    sells.push(share);
  }
  if (sells.length === 0)
    return { field: "sell-0", words: "Give at least one sell button a share." };
  const perClick = solOf(typed.perClick, "per-click", MOST_PER_CLICK);
  if (typeof perClick !== "bigint") return perClick;
  const perDay = solOf(typed.perDay, "per-day", MOST_PER_DAY);
  if (typeof perDay !== "bigint") return perDay;
  if (perDay < perClick)
    return { field: "per-day", words: "A day's limit can't be below a click's." };
  const over = buys.find((each) => each > perClick);
  if (over !== undefined) {
    return { field: "per-click", words: "A buy button is above the most one click may spend." };
  }
  return { ...typed, buys, sells, perClick, perDay };
}

function SettingsForm() {
  const wallet = useWallet();
  const ghosts = wallet.kind === "open" ? (wallet.ghosts?.rows ?? []) : [];
  const [typed, setTyped] = useState<Typed>(() => typedOf(DEFAULT_SETTINGS));
  const [saved, setSaved] = useState<"saved" | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const ids = { perClick: useId(), perDay: useId() };
  useEffect(() => {
    void readSettings().then((read) => setTyped(typedOf(read)));
  }, []);
  const change = (next: Partial<Typed>) => {
    setTyped({ ...typed, ...next });
    setSaved(null);
    setProblem(null);
  };
  const field = (name: string) => (problem?.field === name ? problem.words : null);
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const read = settingsOfTyped(typed);
        if ("field" in read) {
          setProblem(read);
          return;
        }
        void writeSettings(read).then(() => setSaved("saved"));
      }}
    >
      <Card>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-label font-medium text-muted-foreground">
            The ghost wallet that trades
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {(ghosts.length > 0 ? ghosts : [{ index: 0, address: "", sol: null }]).map((ghost) => (
              <label
                key={ghost.index}
                className={cn(
                  "flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                  typed.ghost === ghost.index
                    ? "border-primary bg-frost"
                    : "border-border hover:bg-muted/50",
                )}
              >
                <input
                  type="radio"
                  name="overlay-ghost"
                  checked={typed.ghost === ghost.index}
                  onChange={() => change({ ghost: ghost.index })}
                  className="sr-only"
                />
                <span className="text-sm font-medium">Ghost {ghost.index + 1}</span>
                <span className="text-label text-muted-foreground tabular-nums">
                  {ghost.sol === null ? "New" : `${formatAbout(ghost.sol, 9, 4)} SOL`}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Presets
          legend="Buy buttons, in SOL"
          values={typed.buys}
          prefix="buy"
          problem={problem}
          onChange={(buys) => change({ buys })}
        />
        <Presets
          legend="Sell buttons, as a share of what the ghost wallet holds, in %"
          values={typed.sells}
          prefix="sell"
          problem={problem}
          onChange={(sells) => change({ sells })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            id={ids.perClick}
            label="Most a click spends, SOL"
            value={typed.perClick}
            onChange={(perClick) => change({ perClick })}
            problem={field("per-click")}
          />
          <Field
            id={ids.perDay}
            label="Most a day spends, SOL"
            value={typed.perDay}
            onChange={(perDay) => change({ perDay })}
            problem={field("per-day")}
          />
        </div>
        <label className="flex items-start gap-2 text-label text-pretty">
          <input
            type="checkbox"
            checked={typed.showBalances}
            onChange={(event) => change({ showBalances: event.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Show the ghost wallet's balance on the chip.</span>{" "}
            <span className="text-muted-foreground">
              Off, it stays hidden while you share your screen.
            </span>
          </span>
        </label>
      </Card>
      <button type="submit" className={buttonVariants({ size: "lg", className: "h-10 w-full" })}>
        {saved ? "Saved" : "Save"}
      </button>
    </form>
  );
}

function Presets({
  legend,
  values,
  prefix,
  problem,
  onChange,
}: {
  readonly legend: string;
  readonly values: readonly string[];
  readonly prefix: string;
  readonly problem: Problem | null;
  readonly onChange: (values: readonly string[]) => void;
}) {
  const slots = prefix === "buy" ? 4 : 3;
  const shown = Array.from({ length: slots }, (_, at) => values[at] ?? "");
  const words = problem?.field.startsWith(`${prefix}-`) ? problem.words : null;
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-label font-medium text-muted-foreground">{legend}</legend>
      <div className="grid grid-cols-4 gap-2">
        {shown.map((value, at) => (
          <input
            key={`${prefix}-${String(at)}`}
            aria-label={`${prefix === "buy" ? "Buy" : "Sell"} button ${String(at + 1)}`}
            value={value}
            inputMode="decimal"
            onChange={(event) =>
              onChange(shown.map((each, index) => (index === at ? event.target.value : each)))
            }
            aria-invalid={problem?.field === `${prefix}-${String(at)}`}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
          />
        ))}
      </div>
      {words ? <ProblemLine text={words} /> : null}
    </fieldset>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  problem,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly problem: string | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        value={value}
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={problem !== null}
        className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
      />
      {problem ? <ProblemLine text={problem} /> : null}
    </div>
  );
}
