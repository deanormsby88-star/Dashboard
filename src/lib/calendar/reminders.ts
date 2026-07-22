import {
  ensureOwner,
  getLastSyncRun,
  listCalendarEvents,
  recordSyncRun,
  type CalendarEventRow,
} from "@/lib/db/repo";
import { ensureCalendarsFresh } from "@/lib/calendar/sync";
import { attendeeMotivations, buildMeetingPrep } from "@/lib/calendar/prep";
import { sendToDean } from "@/lib/telegram/notify";
import { wazeLinkFor } from "@/lib/maps";

/**
 * Two nudges per meeting: ~30 min before (with prep) and ~5 min before (a
 * quick heads-up). `within` is the trigger threshold in minutes; the cron runs
 * every 5 min so each tier fires close to its target.
 */
const TIERS = [
  { name: "t30", within: 33, prep: true },
  { name: "t5", within: 6, prep: false },
] as const;
const MAX_LEAD_MIN = 33;

function fmtTime(d: Date): string {
  return new Date(d).toLocaleTimeString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Anything with a specific start time gets a nudge; all-day banners don't. */
function isRemindable(e: CalendarEventRow): boolean {
  return !e.all_day;
}

function reminderKey(e: CalendarEventRow, tier: string): string {
  return `reminder:${e.calendar}:${e.source_uid}:${new Date(e.starts_at).toISOString()}:${tier}`;
}

async function compose(e: CalendarEventRow, now: Date, withPrep: boolean): Promise<string> {
  const minsAway = Math.max(0, Math.round((new Date(e.starts_at).getTime() - now.getTime()) / 60_000));
  const lines = [`⏰ In ${minsAway} min · ${fmtTime(e.starts_at)} — ${e.title}`];
  if (e.location) {
    lines.push(`📍 ${e.location}`);
    const waze = wazeLinkFor(e.location);
    if (waze) lines.push(`🚗 ${waze}`);
  }
  if (e.attendees.length > 0) lines.push(`👥 ${e.attendees.slice(0, 5).join(", ")}`);

  // Attach a prep pack on the 30-min nudge when we hold useful context; the
  // 5-min nudge stays a quick heads-up. Always lead the prep with what matters
  // to each attendee (their saved motivations), so Dean gets that every meeting.
  if (withPrep) {
    const motiv = await attendeeMotivations(e).catch(() => null);
    if (motiv) lines.push(`\n💡 What matters to them:\n${motiv}`);
    const prep = await buildMeetingPrep(e).catch(() => null);
    if (prep) lines.push(`\n📝 Prep:\n${prep}`);
  }
  return lines.join("\n");
}

/**
 * Nudge Dean twice per meeting — ~30 min before (with prep) and ~5 min before.
 * Each tier is deduped durably (sync_runs) so it fires once. If a meeting is
 * added inside 30 min, only the most-urgent applicable tier is sent (the others
 * are marked done so no stale "in 30 min" arrives late). Best-effort per event.
 */
export async function sendDueMeetingReminders(
  now: Date = new Date()
): Promise<{ sent: number; considered: number }> {
  const owner = await ensureOwner();
  await ensureCalendarsFresh(owner.user.id).catch(() => {});

  const windowEnd = new Date(now.getTime() + MAX_LEAD_MIN * 60_000);
  const events = await listCalendarEvents(owner.user.id, now, windowEnd);

  let sent = 0;
  for (const e of events) {
    if (!isRemindable(e)) continue;
    const minsAway = (new Date(e.starts_at).getTime() - now.getTime()) / 60_000;

    // Tiers whose threshold is met and which haven't fired yet.
    const due: Array<(typeof TIERS)[number]> = [];
    for (const t of TIERS) {
      if (minsAway <= t.within && !(await getLastSyncRun(reminderKey(e, t.name)))) due.push(t);
    }
    if (due.length === 0) continue;

    // Send the most-urgent due tier (smallest window); the message's "in X min"
    // reflects reality. Mark every due tier done so an older tier won't re-fire.
    const sendTier = due.reduce((a, b) => (b.within < a.within ? b : a));
    const ok = await sendToDean(await compose(e, now, sendTier.prep));
    if (ok) {
      for (const t of due) {
        await recordSyncRun({ userId: owner.user.id, sourceSystem: reminderKey(e, t.name), stats: { title: e.title, tier: t.name } });
      }
      sent++;
    }
  }
  return { sent, considered: events.length };
}
