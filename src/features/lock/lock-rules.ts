/** How long the wallet may sit unused before it locks, in minutes: the trader picks one. */
export const LOCK_AFTER_CHOICES = [1, 5, 15, 30, 60, 240, 1440] as const;
export type LockAfter = (typeof LOCK_AFTER_CHOICES)[number];
export const DEFAULT_LOCK_AFTER: LockAfter = 30;

/** A send being signed or sent holds the lock back at most this long. */
export const BUSY_HOLDS_MS = 5 * 60_000;

export type LockReason = "idle" | "screen" | "manual";

export function lockAfterOf(value: unknown): LockAfter {
  return LOCK_AFTER_CHOICES.find((choice) => choice === value) ?? DEFAULT_LOCK_AFTER;
}

/** "30 minutes", "4 hours", "1 day". */
export function lockAfterWords(minutes: LockAfter): string {
  if (minutes < 60) return minutes === 1 ? "1 minute" : `${String(minutes)} minutes`;
  if (minutes < 1440) return minutes === 60 ? "1 hour" : `${String(minutes / 60)} hours`;
  return "1 day";
}

/** Whether a send in progress holds the lock back now. */
export function busyNow(busySince: number | null, now: number): boolean {
  return busySince !== null && now - busySince < BUSY_HOLDS_MS;
}

/** Whether the wallet should lock now for having sat unused. */
export function idleExpired(input: {
  readonly now: number;
  readonly lastActive: number | null;
  readonly lockAfter: LockAfter;
}): boolean {
  if (input.lastActive === null) return false;
  return input.now - input.lastActive >= input.lockAfter * 60_000;
}
