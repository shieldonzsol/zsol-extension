import { PLACES, placeHref, type TabId } from "@/app/places";
import { cn } from "@/lib/utils";

export function PlaceTabs({ current }: { readonly current: TabId }) {
  const open = PLACES.findIndex((place) => place.id === current);
  return (
    <nav
      aria-label="Places"
      className="relative grid shrink-0 auto-cols-fr grid-flow-col border-t border-border/60 bg-background"
    >
      {open < 0 ? null : (
        <span
          aria-hidden="true"
          className="absolute top-0 left-0 h-[2px] px-5"
          style={{ width: `${100 / PLACES.length}%`, transform: `translateX(${open * 100}%)` }}
        >
          <span className="block h-full rounded-full bg-gradient-to-r from-primary via-primary/20 to-primary" />
        </span>
      )}
      {PLACES.map((place) => {
        const here = place.id === current;
        const Icon = place.icon;
        return (
          <a
            key={place.id}
            href={placeHref(place.id)}
            aria-current={here ? "page" : undefined}
            className={cn(
              "flex h-14 min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:bg-muted",
              here ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn("size-5", here && "text-primary")}
              strokeWidth={1.5}
            />
            <span className="max-w-full truncate px-1">{place.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
