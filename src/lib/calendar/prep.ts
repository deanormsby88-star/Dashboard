import { getEnv } from "@/lib/env";
import { callText } from "@/lib/ai/openai";
import { findPersonByEmail, findPersonByName, getPersonBundle, type CalendarEventRow } from "@/lib/db/repo";
import { MAILBOX_ADDRESSES } from "@/lib/email/schema";
import type { Person } from "@/lib/types";

/** How many attendees to research for a prep pack (bounds latency/tokens). */
const MAX_ATTENDEES = 4;

/** Dean himself — his own record must never be surfaced as an "attendee". */
const OWNER_EMAILS = new Set(Object.keys(MAILBOX_ADDRESSES));
const OWNER_NAME = /\bdean\s+ormsby\b/i;

/** True when an attendee string, or a resolved person, is Dean (the owner). */
export function isOwnerAttendee(value: string | null | undefined, person?: Person | null): boolean {
  const s = (value ?? "").trim();
  if (s.includes("@") && OWNER_EMAILS.has(s.toLowerCase())) return true;
  if (s && OWNER_NAME.test(s)) return true;
  if (person) {
    if (person.email && OWNER_EMAILS.has(person.email.trim().toLowerCase())) return true;
    if (OWNER_NAME.test(person.full_name)) return true;
  }
  return false;
}

/** Attendees excluding Dean himself, capped for latency/tokens. */
function otherAttendees(event: CalendarEventRow): string[] {
  return event.attendees.filter((a) => !isOwnerAttendee(a)).slice(0, MAX_ATTENDEES);
}

/** Resolve a calendar attendee (name or email) to a stored person. */
async function resolveAttendee(attendee: string): Promise<Person | null> {
  const a = attendee.trim();
  if (!a) return null;
  if (a.includes("@")) {
    const byEmail = await findPersonByEmail(a).catch(() => null);
    if (byEmail) return byEmail;
  }
  return findPersonByName(a).catch(() => null);
}

/**
 * What matters to each attendee — their saved motivations / bio (person.notes).
 * Surfaced on EVERY meeting reminder (deterministically, not via the topic-
 * focused AI prep) so Dean always walks in knowing what drives the people in
 * the room. Returns null when no attendee has notes on file.
 */
export async function attendeeMotivations(event: CalendarEventRow): Promise<string | null> {
  const attendees = otherAttendees(event);
  if (attendees.length === 0) return null;
  const people = await Promise.all(attendees.map((a) => resolveAttendee(a)));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const p of people) {
    // Never surface Dean's own record (or a duplicate / note-less person).
    if (!p || isOwnerAttendee(null, p) || !p.notes?.trim() || seen.has(p.id)) continue;
    seen.add(p.id);
    const first = p.full_name.split(/\s+/)[0] || p.full_name;
    lines.push(`• ${first}: ${p.notes.trim().replace(/\s+/g, " ").slice(0, 240)}`);
  }
  return lines.length ? lines.join("\n") : null;
}

/**
 * Assemble the internal context DeanOS holds on a meeting's attendees:
 * who they are, what each owes whom, when they last met, recent email.
 * Returns null when there's genuinely nothing on file (caller falls back to a
 * plain nudge).
 */
async function gatherContext(event: CalendarEventRow): Promise<{ text: string; known: boolean }> {
  const attendees = otherAttendees(event);
  if (attendees.length === 0) return { text: "(no attendees on file)", known: false };

  const bundles = await Promise.all(attendees.map((a) => getPersonBundle(a).catch(() => null)));
  let known = false;
  const blocks = attendees.map((a, i) => {
    const b = bundles[i];
    const lines: string[] = [];
    if (b?.person?.role || b?.person?.organization) {
      lines.push(`role: ${[b?.person?.role, b?.person?.organization].filter(Boolean).join(", ")}`);
    }
    const open = (b?.commitments ?? []).filter((c) => c.status === "open").slice(0, 4);
    if (open.length) {
      lines.push(
        `open items: ${open
          .map((c) => `${c.direction === "by_dean" ? "you owe them" : "they owe you"} — ${c.text}`)
          .join("; ")}`
      );
    }
    const lastMeeting = b?.meetings?.[0];
    if (lastMeeting) lines.push(`last met: ${lastMeeting.title}${lastMeeting.summary ? ` — ${lastMeeting.summary}` : ""}`);
    if (lines.length) known = true;
    return `${a}:\n  ${lines.length ? lines.join("\n  ") : "(no history on file)"}`;
  });

  return { text: blocks.join("\n"), known };
}

const PREP_SYSTEM = `You are DeanOS, Dean Ormsby's chief of staff, writing a quick pre-meeting prep for a Telegram message. Be concise and practical — Dean reads this walking into the room.

Anchor the prep on what THIS meeting is actually about — read the title and the agenda/notes first and let them drive everything. The attendee background is only supporting colour: use a person's open item or history ONLY if it clearly relates to this meeting's topic. Do NOT turn unrelated recent threads about the attendees into the agenda — if something isn't obviously on-topic, leave it out.

Produce:
1. The single most important OUTCOME to drive, based on the meeting's purpose.
2. 2–3 short, on-topic talking points.
3. If useful, one question worth asking.

Plain text, no markdown headers. Tight — a handful of lines. If the agenda is thin and you can't tell what it's about, say so plainly and keep it to a one-line objective rather than guessing. Never invent an agenda from unrelated attendee history.`;

/**
 * Build a pre-meeting prep pack for Telegram, or null if there's nothing to
 * work with (no agenda and no attendee history → caller falls back to a plain
 * nudge).
 */
export async function buildMeetingPrep(event: CalendarEventRow): Promise<string | null> {
  const { text: context, known } = await gatherContext(event);
  const agenda = event.description?.trim();
  // Nothing to prep from at all.
  if (!known && !agenda) return null;

  const model = getEnv().OPENAI_MODEL_PRIORITIZER;
  const user = `Meeting title: "${event.title}"${event.location ? ` (at ${event.location})` : ""}.
Agenda / notes from the invite: ${agenda || "(none provided)"}

Attendee background (supporting context only — use only what's on-topic):
${context}`;
  const res = await callText({ model, system: PREP_SYSTEM, user, maxOutputTokens: 500 });
  if (!res.ok || !res.rawText?.trim()) return null;
  return res.rawText.trim();
}
