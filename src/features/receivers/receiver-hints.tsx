import { buttonVariants } from "@/components/ui/button";

import { lookalikeOf, recentOf, type Receiver } from "./lookalike";
import { useReceivers } from "./receivers-store";

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/** Under an address field: who was paid before, and a warning for one that only looks alike. */
export function ReceiverHints({
  value,
  kind,
  onPick,
}: {
  readonly value: string;
  readonly kind: Receiver["kind"];
  readonly onPick: (address: string) => void;
}) {
  const known = useReceivers();
  const to = value.trim();
  const look = lookalikeOf(to, known);
  if (look) {
    return (
      <span role="alert" className="flex flex-col gap-1.5">
        <span className="text-destructive">
          This only looks like {short(look.address)}, which you paid before: the middle is
          different. Someone may have sent you dust from it to be copied by mistake.
        </span>
        <button
          type="button"
          onClick={() => onPick(look.address)}
          className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
        >
          Use the one you paid: {short(look.address)}
        </button>
      </span>
    );
  }
  if (to !== "" && known.some((each) => each.address === to)) {
    return <span className="text-muted-foreground">You've paid this address before.</span>;
  }
  const recent = to === "" ? recentOf(known, kind) : [];
  if (recent.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground">Paid before:</span>
      {recent.map((each) => (
        <button
          key={each.address}
          type="button"
          onClick={() => onPick(each.address)}
          className={buttonVariants({ variant: "outline", size: "xs", className: "font-mono" })}
          title={each.address}
          translate="no"
        >
          {short(each.address)}
        </button>
      ))}
    </span>
  );
}

/** On a review: the same warning, once more, before anything is signed. */
export function LookalikeLine({ to }: { readonly to: string }) {
  const look = lookalikeOf(to, useReceivers());
  return look ? (
    <p role="alert" className="text-label text-pretty text-destructive">
      {short(to)} only looks like {short(look.address)}, which you paid before. Check every
      character before you go on.
    </p>
  ) : null;
}
