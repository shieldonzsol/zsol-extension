const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** How long ago a read was, as a short phrase: "just now", "4 min ago", "on Nov 21". */
export function readAge(readAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - readAt) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  return `on ${DAY.format(readAt)}`;
}
