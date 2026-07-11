import {
  ensureOwner,
  getLastSyncRun,
  listCalendarEvents,
  recordSyncRun,
  type CalendarEventRow,
} from "@/lib/db/repo";
import { ensureCalendarsFresh } from "@/lib/calendar/sync";
import { sendToDean } from "@/lib/telegram/notify";
import { wazeLink } from "@/lib/maps";

/** Remind about a meeting when it starts within this many minutes. */
const LEAD_MIN = 35;

function fmtTime(d: Date): string {
  return new Date(d).toLocaleTimeString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** A real meeting worth a nudge: has people or a place. Skips solo focus blocks. */
function isMeeting(e: CalendarEventRow): boolean {
  return !e.all_day && (e.attendees.length > 0 || Boolean(e.location));
}

function reminderKey(e: CalendarEventRow): string {
  return `reminder:${e.calendar}:${e.source_uid}:${new Date(e.starts_at).toISOString()}`;
}

function compose(e: CalendarEventRow, now: Date): string {
  const minsAway = Math.max(0, Math.round((new Date(e.starts_at).getTime() - now.getTime()) / 60_000));
  const lines = [`⏰ In ${minsAway} min · ${fmtTime(e.starts_at)} — ${e.title}`];
  if (e.location) {
    lines.push(`📍 ${e.location}`);
    lines.push(`🚗 ${wazeLink(e.location)}`);
  }
  if (e.attendees.length > 0) lines.push(`👥 ${e.attendees.slice(0, 5).join(", ")}`);
  return lines.join("\n");
}

/**
 * Send a Telegram nudge for each meeting starting in the next LEAD_MIN minutes
 * that hasn't already been reminded. Dedup is durable (sync_runs), so it
 * survives the calendar cache being wiped and re-synced, and never double-pings
 * across cron ticks. Best-effort per event.
 */
export async function sendDueMeetingReminders(
  now: Date = new Date()
): Promise<{ sent: number; considered: number }> {
  const owner = await ensureOwner();
  await ensureCalendarsFresh(owner.user.id).catch(() => {});

  const windowEnd = new Date(now.getTime() + LEAD_MIN * 60_000);
  const events = await listCalendarEvents(owner.user.id, now, windowEnd);

  let sent = 0;
  for (const e of events) {
    if (!isMeeting(e)) continue;
    const key = reminderKey(e);
    if (await getLastSyncRun(key)) continue; // already reminded
    const ok = await sendToDean(compose(e, now));
    if (ok) {
      await recordSyncRun({ userId: owner.user.id, sourceSystem: key, stats: { title: e.title } });
      sent++;
    }
  }
  return { sent, considered: events.length };
}
