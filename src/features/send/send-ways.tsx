import { placeHref } from "@/app/places";
import { cn } from "@/lib/utils";

/** The Send tab's forms: one zSol receiver, a list, or any address by Ghost Route. */
export function SendWays({ current }: { readonly current: "send" | "pay-many" | "ghost-pay" }) {
  const ways = [
    { id: "send", label: "Send dark" },
    { id: "pay-many", label: "Pay many" },
    { id: "ghost-pay", label: "Ghost pay" },
  ] as const;
  return (
    <nav aria-label="Ways to send" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
      {ways.map((way) => (
        <a
          key={way.id}
          href={placeHref(way.id)}
          aria-current={way.id === current ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-center text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            way.id === current
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {way.label}
        </a>
      ))}
    </nav>
  );
}
