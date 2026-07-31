/**
 * Precise reminder ladder for a detected deadline. Given a due date (and
 * optional time) in South African time, produce up to three rungs — the day
 * before, on the day, and an hour before — dropping any that are in the past or
 * fall after the deadline itself. All times are computed in SAST (UTC+2, no DST)
 * and returned as UTC ISO strings for the reminder scheduler.
 */

export type ReminderTier = "day_before" | "on_the_day" | "hour_before";

export interface ReminderRung {
  tier: ReminderTier;
  atIso: string; // UTC ISO
  label: string; // e.g. "Day before — Thu 7 Aug 17:00"
}

const SAST = "+02:00";

/** A wall-clock SAST date+time as a real instant. */
function sastInstant(ymd: string, hm: string): Date {
  return new Date(`${ymd}T${hm}:00${SAST}`);
}

/** Shift a YYYY-MM-DD by whole days without tripping over time zones. */
export function shiftYMD(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function labelFor(at: Date): string {
  return at.toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Human label for the deadline itself (date, plus time if one was given). */
export function deadlineLabel(dueDate: string, dueTime: string | null): string {
  const at = sastInstant(dueDate, dueTime ?? "12:00");
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
    day: "numeric",
    month: "short",
  };
  if (dueTime) {
    opts.hour = "2-digit";
    opts.minute = "2-digit";
    opts.hour12 = false;
  }
  return at.toLocaleString("en-ZA", opts);
}

/**
 * Build the reminder ladder. `dueTime` is "HH:MM" (24h) or null for a date-only
 * deadline. Rungs in the past (relative to `now`) or at/after the deadline are
 * omitted, so the result only contains reminders worth setting.
 */
export function reminderLadder(
  dueDate: string,
  dueTime: string | null,
  now: Date = new Date()
): ReminderRung[] {
  // The deadline instant — end of the due day when no time is specified.
  const deadline = sastInstant(dueDate, dueTime ?? "23:59");

  const candidates: ReminderRung[] = [];

  // Day before at 17:00 SAST — "heads up, due tomorrow".
  const dayBefore = sastInstant(shiftYMD(dueDate, -1), "17:00");
  candidates.push({ tier: "day_before", atIso: dayBefore.toISOString(), label: `Day before — ${labelFor(dayBefore)}` });

  // On the day at 08:00 SAST — "due today".
  const onDay = sastInstant(dueDate, "08:00");
  candidates.push({ tier: "on_the_day", atIso: onDay.toISOString(), label: `On the day — ${labelFor(onDay)}` });

  // One hour before — only meaningful when a time was given.
  if (dueTime) {
    const hourBefore = new Date(deadline.getTime() - 3600_000);
    candidates.push({ tier: "hour_before", atIso: hourBefore.toISOString(), label: `1 hour before — ${labelFor(hourBefore)}` });
  }

  const nowMs = now.getTime();
  const deadlineMs = deadline.getTime();
  return candidates
    .filter((r) => {
      const t = new Date(r.atIso).getTime();
      return t > nowMs && t < deadlineMs;
    })
    .sort((a, b) => new Date(a.atIso).getTime() - new Date(b.atIso).getTime());
}
