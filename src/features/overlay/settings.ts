// What one click on the overlay may do, as the trader set it in the panel: which ghost wallet
// trades, the buy amounts and sell shares on its buttons, and the most a click and a day may spend.
// Kept on this device, not secret.
import { browser } from "wxt/browser";

export interface OverlaySettings {
  /** The ghost wallet that trades, by its number from 0. */
  readonly ghost: number;
  /** Each buy button's amount of SOL, in lamports. */
  readonly buys: readonly bigint[];
  /** Each sell button's share of what the ghost wallet holds of the token, in percent. */
  readonly sells: readonly number[];
  /** The most SOL one click may spend, and one UTC day. */
  readonly perClick: bigint;
  readonly perDay: bigint;
  readonly slippageBps: number;
  /** Balances show on the chip only when the trader asks: screens get shared. */
  readonly showBalances: boolean;
}

const SOL = 1_000_000_000n;

export const DEFAULT_SETTINGS: OverlaySettings = {
  ghost: 0,
  buys: [SOL / 20n, SOL / 10n, SOL / 4n],
  sells: [50, 100],
  perClick: SOL / 2n,
  perDay: 2n * SOL,
  slippageBps: 100,
  showBalances: false,
};

/** The most a click and a day may ever be set to. */
export const MOST_PER_CLICK = 10n * SOL;
export const MOST_PER_DAY = 50n * SOL;
const SLIPPAGES = new Set([50, 100, 200, 300]);

const KEY = "overlay";
const SPENT = "overlay-spent";

const lamports = (value: unknown, most: bigint): bigint | null =>
  typeof value === "string" &&
  /^\d{1,20}$/.test(value) &&
  BigInt(value) > 0n &&
  BigInt(value) <= most
    ? BigInt(value)
    : null;

/** Settings as kept, each field checked; what doesn't read as kept falls back to its default. */
export function settingsOf(kept: unknown): OverlaySettings {
  if (typeof kept !== "object" || kept === null) return DEFAULT_SETTINGS;
  const get = (name: string): unknown => Reflect.get(kept, name);
  const ghost = get("ghost");
  const perClick = lamports(get("perClick"), MOST_PER_CLICK) ?? DEFAULT_SETTINGS.perClick;
  const perDay = lamports(get("perDay"), MOST_PER_DAY) ?? DEFAULT_SETTINGS.perDay;
  const buysRead = get("buys");
  const buys = Array.isArray(buysRead)
    ? buysRead.map((each) => lamports(each, MOST_PER_CLICK)).filter((each) => each !== null)
    : [];
  const sellsRead = get("sells");
  const sells = Array.isArray(sellsRead)
    ? sellsRead.filter((each): each is number => Number.isInteger(each) && each >= 1 && each <= 100)
    : [];
  const slippage = get("slippageBps");
  return {
    ghost: Number.isInteger(ghost) && Number(ghost) >= 0 && Number(ghost) < 500 ? Number(ghost) : 0,
    buys: buys.length > 0 ? buys.slice(0, 4) : DEFAULT_SETTINGS.buys,
    sells: sells.length > 0 ? sells.slice(0, 3) : DEFAULT_SETTINGS.sells,
    perClick,
    perDay: perDay < perClick ? perClick : perDay,
    slippageBps: typeof slippage === "number" && SLIPPAGES.has(slippage) ? slippage : 100,
    showBalances: get("showBalances") === true,
  };
}

const keptOf = (settings: OverlaySettings) => ({
  ghost: settings.ghost,
  buys: settings.buys.map(String),
  sells: [...settings.sells],
  perClick: String(settings.perClick),
  perDay: String(settings.perDay),
  slippageBps: settings.slippageBps,
  showBalances: settings.showBalances,
});

export async function readSettings(): Promise<OverlaySettings> {
  return settingsOf((await browser.storage.local.get(KEY))[KEY]);
}

export async function writeSettings(settings: OverlaySettings): Promise<void> {
  await browser.storage.local.set({ [KEY]: keptOf(settingsOf(keptOf(settings))) });
}

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** What the day's clicks spent so far, in lamports. */
export function spentToday(kept: unknown, now: number): bigint {
  if (typeof kept !== "object" || kept === null) return 0n;
  const day: unknown = Reflect.get(kept, "day");
  const spent: unknown = Reflect.get(kept, "lamports");
  return day === dayOf(now) && typeof spent === "string" && /^\d{1,20}$/.test(spent)
    ? BigInt(spent)
    : 0n;
}

/** Why a buy of `amount` can't go by one click now, or null when it can. */
export function overLimit(
  settings: OverlaySettings,
  amount: bigint,
  spent: bigint,
): "per-click" | "per-day" | null {
  if (amount > settings.perClick) return "per-click";
  if (spent + amount > settings.perDay) return "per-day";
  return null;
}

export async function readSpent(now = Date.now()): Promise<bigint> {
  return spentToday((await browser.storage.local.get(SPENT))[SPENT], now);
}

export async function noteSpent(amount: bigint, now = Date.now()): Promise<void> {
  const spent = await readSpent(now);
  await browser.storage.local.set({
    [SPENT]: { day: dayOf(now), lamports: String(spent + amount) },
  });
}
