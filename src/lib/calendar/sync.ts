import {
  ensureOwner,
  getLastSyncRun,
  listCalendarConnections,
  listCalendarEvents,
  recordSyncRun,
  replaceCalendarEvents,
  type CalendarEventRow,
} from "@/lib/db/repo";
import type { BusinessKey } from "@/lib/types";
import { getValidAccessToken, listEvents } from "@/lib/calendar/microsoft";

const WINDOW_BACK_DAYS = 1;
const WINDOW_FWD_DAYS = 21;

/** Pull one calendar's events for the window and cache them. */
export async function syncCalendar(userId: string, calendar: BusinessKey, businessId: string | null): Promise<number> {
  const token = await getValidAccessToken(userId, calendar);
  if (!token) return 0;
  const now = Date.now();
  const from = new Date(now - WINDOW_BACK_DAYS * 86400_000);
  const to = new Date(now + WINDOW_FWD_DAYS * 86400_000);
  const events = await listEvents(token, from.toISOString(), to.toISOString());
  await replaceCalendarEvents(
    userId,
    calendar,
    from,
    to,
    events.map((e) => ({
      sourceUid: e.id,
      title: e.subject,
      location: e.location,
      organizer: e.organizer,
      attendees: e.attendees,
      startsAt: new Date(e.start),
      endsAt: e.end ? new Date(e.end) : null,
      allDay: e.allDay,
      url: e.webLink,
      description: e.bodyPreview,
      businessId,
    }))
  );
  await recordSyncRun({ userId, sourceSystem: `calendar:${calendar}`, stats: { events: events.length } });
  return events.length;
}

/** Sync all connected calendars whose cache is older than maxAgeMin. */
export async function ensureCalendarsFresh(userId: string, maxAgeMin = 10): Promise<void> {
  const owner = await ensureOwner();
  const conns = await listCalendarConnections(userId);
  await Promise.all(
    conns.map(async (c) => {
      const last = await getLastSyncRun(`calendar:${c.calendar}`);
      if (last && Date.now() - last.getTime() < maxAgeMin * 60_000) return;
      const business = owner.businesses.find((b) => b.key === c.calendar);
      try {
        await syncCalendar(userId, c.calendar, business?.id ?? null);
      } catch {
        /* best-effort; stale cache still serves reads */
      }
    })
  );
}

export interface CalendarView {
  events: CalendarEventRow[];
}

/** Fresh-ish events between now and `days` ahead (today = 1). */
export async function getUpcoming(userId: string, days = 7): Promise<CalendarEventRow[]> {
  await ensureCalendarsFresh(userId);
  const from = new Date();
  const to = new Date(Date.now() + days * 86400_000);
  return listCalendarEvents(userId, from, to);
}

/** Today's events (local day is approximated by a 24h window from now-6h). */
export async function getToday(userId: string): Promise<CalendarEventRow[]> {
  await ensureCalendarsFresh(userId);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 86400_000);
  return listCalendarEvents(userId, start, end);
}
