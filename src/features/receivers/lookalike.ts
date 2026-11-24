// Address poisoning: someone sends dust from an address that starts and ends like one you paid,
// hoping you copy theirs next time. A receiver that only looks like a known one is said plainly.

export interface Receiver {
  readonly address: string;
  /** zSol: a private wallet paid privately; public: an address paid in public. */
  readonly kind: "zsol" | "public";
  readonly lastAt: number;
  readonly count: number;
}

const ENDS = 4;

/** A known receiver this address only looks like: same ends, different middle. */
export function lookalikeOf(address: string, known: readonly Receiver[]): Receiver | null {
  const to = address.trim();
  if (to.length < 32) return null;
  return (
    known.find(
      (each) =>
        each.address !== to &&
        each.address.slice(0, ENDS) === to.slice(0, ENDS) &&
        each.address.slice(-ENDS) === to.slice(-ENDS),
    ) ?? null
  );
}

/** The receivers worth offering, most recent first. */
export function recentOf(known: readonly Receiver[], kind: Receiver["kind"] | null, most = 4) {
  return known
    .filter((each) => kind === null || each.kind === kind)
    .toSorted((a, b) => b.lastAt - a.lastAt)
    .slice(0, most);
}

/** The list with `address` paid once more, newest kept, at most `most`. */
export function remembered(
  known: readonly Receiver[],
  address: string,
  kind: Receiver["kind"],
  now: number,
  most = 20,
): Receiver[] {
  const before = known.find((each) => each.address === address && each.kind === kind);
  const rest = known.filter((each) => !(each.address === address && each.kind === kind));
  return [{ address, kind, lastAt: now, count: (before?.count ?? 0) + 1 }, ...rest]
    .toSorted((a, b) => b.lastAt - a.lastAt)
    .slice(0, most);
}
