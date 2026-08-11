import {
  findPersonByName,
  getLastSyncRun,
  listCalendarEvents,
  recordSyncRun,
  type Owner,
} from "@/lib/db/repo";
import { ensureCalendarsFresh } from "@/lib/calendar/sync";
import { messageTeammate } from "@/lib/teams/send";

/** Only auto-remind attendees when a meeting is within this many minutes. */
const OFFER_WINDOW_MIN = 45;

interface OfferAttendee {
  name: string;
  email: string;
}
interface PendingOffer {
  title: string;
  startIso: string;
  attendees: OfferAttendee[];
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Dean's daily 1-1s auto-remind their attendee (no approval needed). */
function isDaily1on1(title: string): boolean {
  return /\b1\s*[-:]\s*1\b/.test(title) || /\bone[-\s]?on[-\s]?one\b/i.test(title);
}

/** People who must never receive attendee reminders. Lisa (former EA) was
 *  removed from DeanOS at Dean's request — keep her suppressed so the bot never
 *  pings her on Teams even if she lingers as a calendar attendee. */
const NEVER_REMIND_EMAILS = new Set(["lisaw@heya.team"]);
const NEVER_REMIND_NAME = /\blisa\s+wainbergas\b|^\s*lisa\s*$/i;

/** Resolve a meeting's attendees to Heya teammates we can message on Teams. */
async function resolveTeammates(userId: string, attendees: string[]): Promise<OfferAttendee[]> {
  const out: OfferAttendee[] = [];
  const seen = new Set<string>();
  for (const a of attendees) {
    if (NEVER_REMIND_NAME.test(a)) continue;
    let email: string | null = null;
    let name = a;
    if (/@/.test(a)) {
      email = a.trim();
    } else {
      const person = await findPersonByName(userId, a).catch(() => null);
      if (person?.email) {
        email = person.email;
        name = person.full_name;
      }
    }
    if (!email || !/@heya\.team$/i.test(email) || seen.has(email.toLowerCase())) continue;
    if (NEVER_REMIND_EMAILS.has(email.toLowerCase()) || NEVER_REMIND_NAME.test(name)) continue;
    seen.add(email.toLowerCase());
    out.push({ name, email });
  }
  return out;
}

/**
 * Auto-remind teammates about Dean's daily 1-1s on Teams — silently, no
 * approval and no ping back to Dean (this only ever messages the teammate,
 * never Dean, so it doesn't add to his notification load). Other meetings
 * with teammate attendees are left alone; ask the assistant directly if you
 * want a specific meeting's attendees reminded.
 */
export async function offerAttendeeReminders(owner: Owner, now: Date = new Date()): Promise<{ offered: number }> {
  await ensureCalendarsFresh(owner.user.id).catch(() => {});

  const events = await listCalendarEvents(owner.user.id, now, new Date(now.getTime() + OFFER_WINDOW_MIN * 60_000));
  let offered = 0;
  for (const e of events) {
    if (e.all_day || e.attendees.length === 0 || !isDaily1on1(e.title)) continue;
    const dedupKey = `attoffered:${e.calendar}:${e.source_uid}:${new Date(e.starts_at).toISOString()}`;
    if (await getLastSyncRun(dedupKey)) continue;

    const teammates = await resolveTeammates(owner.user.id, e.attendees);
    await recordSyncRun({ userId: owner.user.id, sourceSystem: dedupKey, stats: { title: e.title } });
    if (teammates.length === 0) continue;

    const offer: PendingOffer = { title: e.title, startIso: new Date(e.starts_at).toISOString(), attendees: teammates.slice(0, 10) };
    const sent = await sendAttendeeReminders(offer, now);
    if (sent > 0) offered++;
  }
  return { offered };
}

/** Send the Teams reminders to a resolved offer's attendees. Returns count sent. */
export async function sendAttendeeReminders(offer: PendingOffer, now: Date = new Date()): Promise<number> {
  const mins = Math.max(0, Math.round((new Date(offer.startIso).getTime() - now.getTime()) / 60_000));
  let sent = 0;
  for (const a of offer.attendees) {
    const first = a.name.split(" ")[0] || "there";
    const body = `Hi ${first}, reminder — “${offer.title}” with Dean at ${fmtTime(offer.startIso)}${mins ? ` (in ~${mins} min)` : ""}.\n\nThanks, Dean`;
    const res = await messageTeammate(a.email, body);
    if (res.ok) sent++;
  }
  return sent;
}
