import { randomUUID } from "node:crypto";
import {
  ensureOwner,
  findPersonByName,
  getLastSyncRun,
  listCalendarEvents,
  listSyncRunsBySource,
  recordSyncRun,
} from "@/lib/db/repo";
import { ensureCalendarsFresh } from "@/lib/calendar/sync";
import { sendToDean, sendToDeanWithButtons } from "@/lib/telegram/notify";
import { messageTeammate } from "@/lib/teams/send";

/** Offer to remind attendees when a meeting is within this many minutes. */
const OFFER_WINDOW_MIN = 45;

interface OfferAttendee {
  name: string;
  email: string;
}
interface PendingOffer {
  id: string;
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

/** Resolve a meeting's attendees to Heya teammates we can message on Teams. */
async function resolveTeammates(attendees: string[]): Promise<OfferAttendee[]> {
  const out: OfferAttendee[] = [];
  const seen = new Set<string>();
  for (const a of attendees) {
    let email: string | null = null;
    let name = a;
    if (/@/.test(a)) {
      email = a.trim();
    } else {
      const person = await findPersonByName(a).catch(() => null);
      if (person?.email) {
        email = person.email;
        name = person.full_name;
      }
    }
    if (!email || !/@heya\.team$/i.test(email) || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push({ name, email });
  }
  return out;
}

/**
 * For each upcoming meeting with teammate attendees, ask Dean (once) whether to
 * remind them on Teams. On approval (webhook callback) each teammate is pinged.
 */
export async function offerAttendeeReminders(now: Date = new Date()): Promise<{ offered: number }> {
  const owner = await ensureOwner();
  await ensureCalendarsFresh(owner.user.id).catch(() => {});

  const events = await listCalendarEvents(owner.user.id, now, new Date(now.getTime() + OFFER_WINDOW_MIN * 60_000));
  let offered = 0;
  for (const e of events) {
    if (e.all_day || e.attendees.length === 0) continue;
    const dedupKey = `attoffered:${e.calendar}:${e.source_uid}:${new Date(e.starts_at).toISOString()}`;
    if (await getLastSyncRun(dedupKey)) continue;

    const teammates = await resolveTeammates(e.attendees);
    // Mark offered regardless, so we don't re-scan this meeting each tick.
    await recordSyncRun({ userId: owner.user.id, sourceSystem: dedupKey, stats: { title: e.title } });
    if (teammates.length === 0) continue;

    const id = randomUUID().slice(0, 8);
    const offer: PendingOffer = { id, title: e.title, startIso: new Date(e.starts_at).toISOString(), attendees: teammates.slice(0, 10) };

    // Daily 1-1s: auto-remind, no approval; else ask Dean first.
    if (isDaily1on1(e.title)) {
      const sent = await sendAttendeeReminders(offer, now);
      if (sent > 0) {
        await sendToDean(`🔔 Reminded ${teammates.map((t) => t.name.split(" ")[0]).join(", ")} about your ${fmtTime(offer.startIso)} 1-1 on Teams.`);
        offered++;
      }
      continue;
    }

    await recordSyncRun({ userId: owner.user.id, sourceSystem: `attoffer:${id}`, stats: offer });
    const card = `👥 Remind attendees of your ${fmtTime(offer.startIso)} — “${e.title}”?\nWould ping on Teams: ${teammates.map((t) => t.name.split(" ")[0]).join(", ")}`;
    const ok = await sendToDeanWithButtons(card, [
      [
        { text: "✅ Remind them", callback_data: `attrem:go:${id}` },
        { text: "❌ Skip", callback_data: `attrem:skip:${id}` },
      ],
    ]);
    if (ok) offered++;
  }
  return { offered };
}

export async function getPendingOffer(id: string): Promise<PendingOffer | null> {
  if (await getLastSyncRun(`attofferdone:${id}`)) return null;
  const rows = await listSyncRunsBySource(`attoffer:${id}`, 7);
  const s = rows[0]?.stats as unknown as PendingOffer | undefined;
  return s?.attendees ? s : null;
}

export async function markOfferDone(id: string): Promise<void> {
  const owner = await ensureOwner();
  await recordSyncRun({ userId: owner.user.id, sourceSystem: `attofferdone:${id}`, stats: {} });
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
