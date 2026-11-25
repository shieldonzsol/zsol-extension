// What the overlay's chip and the background say to each other over one port per tab. The chip
// asks; the background, which holds the open wallet, decides and answers. The chip sends no
// amount and no token: only which of the trader's own buttons was pressed.

export const OVERLAY_PORT = "zsol-overlay";

export type ChipAsk =
  | { readonly ask: "state" }
  | { readonly ask: "swap"; readonly side: "buy" | "sell"; readonly button: number };

export interface ChipToken {
  readonly mint: string;
  readonly symbol: string;
}

export type ChipState =
  | { readonly kind: "off" }
  | { readonly kind: "locked" }
  | {
      readonly kind: "ready";
      readonly token: ChipToken | null;
      readonly ghost: number;
      /** As people read them; null while hidden. */
      readonly sol: string | null;
      readonly held: string | null;
      readonly buys: readonly string[];
      readonly sells: readonly number[];
    };

export type ChipNews =
  | { readonly news: "state"; readonly state: ChipState }
  | { readonly news: "step"; readonly words: string }
  | { readonly news: "done"; readonly words: string; readonly link: string }
  | { readonly news: "stopped"; readonly words: string };

export function chipAskOf(value: unknown): ChipAsk | null {
  if (typeof value !== "object" || value === null) return null;
  const ask: unknown = Reflect.get(value, "ask");
  if (ask === "state") return { ask };
  if (ask !== "swap") return null;
  const side: unknown = Reflect.get(value, "side");
  const button: unknown = Reflect.get(value, "button");
  return (side === "buy" || side === "sell") &&
    typeof button === "number" &&
    Number.isInteger(button) &&
    button >= 0 &&
    button < 4
    ? { ask, side, button }
    : null;
}
