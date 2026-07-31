import { businessDaysBetween } from "@/lib/dates";
import type { Commitment } from "@/lib/types";

/**
 * Accountability thresholds — how long an open loop may sit before DeanOS
 * nudges. "Assertive" (Dean's chosen setting): chase things you owe fast, and
 * things owed to you a little slower before prodding others.
 */
export interface LoopThresholds {
  /** Business days before nudging on something YOU owe (by_dean). */
  owedByYouDays: number;
  /** Business days before nudging on something owed TO you (to_dean). */
  owedToYouDays: number;
}

export const ASSERTIVE_THRESHOLDS: LoopThresholds = { owedByYouDays: 2, owedToYouDays: 4 };

/** Midnight (UTC day) for a date, so due-date comparisons are day-granular. */
function startOfUTCDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Business days a commitment has been sitting since it was made. */
export function businessDaysStale(c: Pick<Commitment, "date_made" | "created_at">, now: Date): number {
  const from = c.date_made ?? c.created_at;
  return businessDaysBetween(new Date(from), now);
}

/** True when a due date is today or already past. */
export function isDueOrOverdue(dueDate: Date | null, now: Date): boolean {
  if (!dueDate) return false;
  return startOfUTCDay(new Date(dueDate)) <= startOfUTCDay(now);
}

/**
 * Should this open loop be nudged now? Pure decision — no cooldown/snooze here
 * (the scanner layers those on top). Done/cancelled loops never nudge.
 */
export function loopNeedsNudge(
  c: Pick<Commitment, "status" | "direction" | "date_made" | "created_at" | "due_date">,
  now: Date,
  thresholds: LoopThresholds = ASSERTIVE_THRESHOLDS
): boolean {
  if (c.status !== "open") return false;
  const stale = businessDaysStale(c, now);
  if (c.direction === "by_dean") {
    // Something you owe: a due date that's arrived beats the staleness clock.
    if (isDueOrOverdue(c.due_date, now)) return true;
    return stale >= thresholds.owedByYouDays;
  }
  // Something owed to you.
  return stale >= thresholds.owedToYouDays;
}
