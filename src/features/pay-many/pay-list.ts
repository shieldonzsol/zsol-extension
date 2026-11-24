// Pay many's list: one payment a line, "address, amount", typed, pasted or read from a CSV.
import { isAddress } from "@solana/kit";

import { readAmount } from "@/features/rings/amount-input";

/** Payments in one transaction: 15 outputs, one of them zSol's fee. */
export const MAX_PAYEES = 14;

export interface PayRow {
  readonly address: string;
  readonly amount: bigint;
  /** Its line in the list, from 1. */
  readonly line: number;
}

/** What is wrong with one line: `comma` is a decimal comma ("0,5"). */
export type LineProblem = "format" | "address" | "amount" | "comma" | "twice" | "own";

export type PayList =
  | { readonly ok: true; readonly rows: readonly PayRow[] }
  | { readonly ok: false; readonly problem: "empty" }
  | { readonly ok: false; readonly problem: "too-many"; readonly count: number }
  | {
      readonly ok: false;
      readonly problem: LineProblem;
      /** 1-based, as an editor counts lines. */
      readonly line: number;
      /** Every other line with a problem, so all are fixed at once. */
      readonly also: readonly number[];
    };

const unquote = (cell: string) =>
  cell
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2")
    .trim();

/** The address ends at the first comma, semicolon, tab or space; the rest is its amount. */
function cellsOf(line: string): { readonly address: string; readonly amount: string } {
  const match = /^("[^"]*"|'[^']*'|[^\s,;]+)[\s,;]*(.*)$/.exec(line);
  return match
    ? { address: unquote(match[1] ?? ""), amount: unquote(match[2] ?? "") }
    : { address: line, amount: "" };
}

function lineProblem(
  address: string,
  typed: string,
  decimals: number,
  own: string,
  seen: ReadonlySet<string>,
): LineProblem | { readonly amount: bigint } {
  if (typed === "") return "format";
  if (!isAddress(address)) return "address";
  if (address === own) return "own";
  if (seen.has(address)) return "twice";
  const read = readAmount(typed, decimals);
  if (read.ok) return { amount: read.amount };
  if (read.problem === "comma") return "comma";
  // More than one cell after the address ("1 2", "1.5,note"): not a payment line.
  return /[\s;]|,\D/.test(typed) ? "format" : "amount";
}

/**
 * Reads a list. Blank lines are skipped, and so is a first line that is a CSV header. Every bad
 * line is named, the first one first.
 */
export function parsePayList(text: string, decimals: number, own: string): PayList {
  const rows: PayRow[] = [];
  const seen = new Set<string>();
  const bad: { readonly problem: LineProblem; readonly line: number }[] = [];
  for (const [at, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === "") continue;
    const { address, amount: typed } = cellsOf(line);
    const header =
      rows.length === 0 && bad.length === 0 && !isAddress(address) && !/\d/.test(typed);
    if (header) continue;
    const problem = lineProblem(address, typed, decimals, own, seen);
    if (typeof problem === "string") {
      bad.push({ problem, line: at + 1 });
      continue;
    }
    seen.add(address);
    rows.push({ address, amount: problem.amount, line: at + 1 });
  }
  const [first, ...rest] = bad;
  if (first) return { ok: false, ...first, also: rest.map((each) => each.line) };
  if (rows.length === 0) return { ok: false, problem: "empty" };
  if (rows.length > MAX_PAYEES) return { ok: false, problem: "too-many", count: rows.length };
  return { ok: true, rows };
}

/** The list without line `line` (1-based). */
export function withoutLine(text: string, line: number): string {
  return text
    .split(/\r?\n/)
    .filter((_, at) => at !== line - 1)
    .join("\n");
}

/** The list without every line paying one of `addresses`. */
export function withoutAddresses(text: string, addresses: readonly string[]): string {
  const gone = new Set(addresses);
  return text
    .split(/\r?\n/)
    .filter((raw) => !gone.has(cellsOf(raw.trim()).address))
    .join("\n");
}

const isPayment = (raw: string) => {
  const { amount } = cellsOf(raw.trim());
  return raw.trim() !== "" && /\d/.test(amount);
};

/** The list cut at its `most`th payment: what is paid now, and the rest, to pay next. */
export function splitPayments(
  text: string,
  most: number,
): { readonly first: string; readonly rest: string } {
  let kept = 0;
  const first: string[] = [];
  const rest: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!isPayment(raw)) {
      first.push(raw);
      continue;
    }
    kept += 1;
    (kept <= most ? first : rest).push(raw);
  }
  return { first: first.join("\n").trim(), rest: rest.join("\n") };
}
