// Telling the trader when a Ghost Route payout lands, or stops: the plans they asked to hear
// about are kept on this device, and the background asks zSol about them once a minute until
// every part has an outcome.
import { browser } from "wxt/browser";

import { formatAmount } from "@/features/rings/amounts";
import { siteFetch } from "@/features/rings/site-fetch";

export const PAYOUT_ALARM = "payouts";
const WATCH = "payout-watch";
/** A plan is let go of after this, whatever its parts say. */
const WATCH_MS = 8 * 24 * 60 * 60_000;

export interface PayoutRow {
  readonly id: number;
  readonly plan: string;
  readonly part: number;
  readonly recipient: string;
  readonly state: "awaiting" | "due" | "paying" | "paid" | "failed";
  readonly received: bigint | null;
  readonly amount: bigint;
  readonly shield: boolean;
}

interface Watch {
  readonly plans: readonly { readonly plan: string; readonly since: number }[];
  /** Parts already told about. */
  readonly told: readonly number[];
}

const STATES: readonly PayoutRow["state"][] = ["awaiting", "due", "paying", "paid", "failed"];
const isState = (value: unknown): value is PayoutRow["state"] =>
  typeof value === "string" && (STATES as readonly string[]).includes(value);

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

const digits = (value: unknown) =>
  typeof value === "string" && /^\d{1,20}$/.test(value) ? BigInt(value) : null;

export function payoutRowsOf(body: unknown): PayoutRow[] {
  const rows = field(body, "payouts");
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown): PayoutRow[] => {
    const id = field(row, "id");
    const plan = field(row, "plan");
    const part = field(row, "part");
    const recipient = field(row, "recipient");
    const state = field(row, "state");
    const amount = digits(field(row, "amount"));
    if (
      typeof id !== "number" ||
      typeof plan !== "string" ||
      typeof part !== "number" ||
      typeof recipient !== "string" ||
      !isState(state) ||
      amount === null
    ) {
      return [];
    }
    return [
      {
        id,
        plan,
        part,
        recipient,
        state,
        received: digits(field(row, "received")),
        amount,
        shield: field(row, "shield") === true,
      },
    ];
  });
}

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/** What one part's outcome says, for a notification. */
export function newsOf(row: PayoutRow): { readonly title: string; readonly message: string } {
  if (row.state === "failed") {
    return {
      title: "A Ghost Route payout stopped",
      message: `The part for ${short(row.recipient)} didn't go out. Open zSol to see why.`,
    };
  }
  const sol = formatAmount(row.received ?? row.amount, 9);
  return {
    title: "Ghost Route paid out",
    message: row.shield
      ? `${sol} SOL reached ${short(row.recipient)}'s private balance.`
      : `${sol} SOL reached ${short(row.recipient)}.`,
  };
}

/** The parts to tell about now, and what is still worth watching. */
export function newsFor(
  rows: readonly PayoutRow[],
  watch: Watch,
  now: number,
): { readonly tell: readonly PayoutRow[]; readonly next: Watch } {
  const told = new Set(watch.told);
  const watched = new Set(watch.plans.map((each) => each.plan));
  const tell = rows.filter(
    (row) =>
      watched.has(row.plan) &&
      !told.has(row.id) &&
      (row.state === "paid" || row.state === "failed"),
  );
  const open = new Set(
    rows.filter((row) => row.state !== "paid" && row.state !== "failed").map((row) => row.plan),
  );
  const plans = watch.plans.filter(
    (each) =>
      now - each.since < WATCH_MS &&
      (open.has(each.plan) || !rows.some((row) => row.plan === each.plan)),
  );
  const keep = new Set(plans.map((each) => each.plan));
  return {
    tell,
    next: {
      plans,
      told: [...told, ...tell.map((row) => row.id)].filter((id) =>
        rows.some((row) => row.id === id && keep.has(row.plan)),
      ),
    },
  };
}

function watchOf(kept: unknown): Watch {
  const plans = field(kept, "plans");
  const told = field(kept, "told");
  return {
    plans: Array.isArray(plans)
      ? plans.flatMap((each: unknown) => {
          const plan = field(each, "plan");
          const since = field(each, "since");
          return typeof plan === "string" && typeof since === "number" ? [{ plan, since }] : [];
        })
      : [],
    told: Array.isArray(told) ? told.filter((id): id is number => typeof id === "number") : [],
  };
}

const readWatch = async () => watchOf((await browser.storage.local.get(WATCH))[WATCH]);

/** Asks Chrome to let zSol notify, from a click, and watches the plan. False when refused. */
export async function notifyWhenPaid(plan: string): Promise<boolean> {
  const granted = await browser.permissions.request({ permissions: ["notifications"] });
  if (!granted) return false;
  const watch = await readWatch();
  if (!watch.plans.some((each) => each.plan === plan)) {
    await browser.storage.local.set({
      [WATCH]: { ...watch, plans: [...watch.plans, { plan, since: Date.now() }] },
    });
  }
  await browser.alarms.create(PAYOUT_ALARM, { periodInMinutes: 1 });
  return true;
}

/** One look at the watched plans, from the background: tells what landed, stops when done. */
export async function checkPayouts(site: string): Promise<void> {
  const watch = await readWatch();
  if (watch.plans.length === 0) {
    await browser.alarms.clear(PAYOUT_ALARM);
    return;
  }
  const response = await siteFetch(site)(`${site}/api/pool-payouts`, { cache: "no-store" });
  // Signed out with the panel closed: asked again on the next alarm, once it is open.
  if (!response.ok) return;
  const rows = payoutRowsOf(await response.json().catch(() => null));
  const { tell, next } = newsFor(rows, watch, Date.now());
  const mayNotify = await browser.permissions.contains({ permissions: ["notifications"] });
  if (mayNotify) {
    await Promise.all(
      tell.map((row) => {
        const news = newsOf(row);
        return browser.notifications.create(`payout-${String(row.id)}`, {
          type: "basic",
          iconUrl: browser.runtime.getURL("/icon/128.png"),
          title: news.title,
          message: news.message,
        });
      }),
    );
  }
  await browser.storage.local.set({ [WATCH]: next });
  if (next.plans.length === 0) await browser.alarms.clear(PAYOUT_ALARM);
}
