import { getLastSyncRun, listPeopleWithCounts, recordSyncRun } from "@/lib/db/repo";
import { draftCheckIn, stagePendingChase } from "@/lib/accountability/chase";
import type { Owner } from "@/lib/db/repo";

/** A contact counts as stale once it's been this many days since any activity. */
export const STALE_CONTACT_DAYS = 42; // ~6 weeks

const RENUDGE_DAYS = 21; // don't re-nudge the same person within 3 weeks
const DISMISS_DAYS = 90; // "Not now" parks a person for ~3 months

/** Someone Dean deliberately cares about — he's recorded who they are / what drives them. */
export function isKeyContact(p: { notes?: string | null }): boolean {
  return Boolean(p.notes && p.notes.trim().length > 0);
}

/** Whole days since a date, or null if there's no usable baseline. */
export function daysSince(last: Date | string | null, now: Date): number | null {
  if (!last) return null;
  const d = new Date(last);
  if (d.getFullYear() < 2000) return null; // 'epoch' sentinel = never interacted
  return Math.floor((now.getTime() - d.getTime()) / 86400_000);
}

/** True when a real prior relationship has gone quiet past the threshold. */
export function contactIsStale(
  last: Date | string | null,
  now: Date,
  thresholdDays: number = STALE_CONTACT_DAYS
): boolean {
  const d = daysSince(last, now);
  return d !== null && d >= thresholdDays;
}

function within(last: Date | null, now: Date, days: number): boolean {
  return !!last && now.getTime() - last.getTime() < days * 86400_000;
}

/**
 * Nudge Dean about important contacts who've gone quiet, with a ready-to-send
 * reconnect note. "Important" = someone whose motivations/notes he's recorded.
 */
export async function scanStaleContacts(owner: Owner, now: Date = new Date()): Promise<{ sent: number; scanned: number }> {
  const people = await listPeopleWithCounts(owner.user.id);

  let sent = 0;
  let scanned = 0;
  for (const p of people) {
    if (!isKeyContact(p)) continue;
    if (!contactIsStale(p.last_activity, now)) continue;
    scanned++;

    if (within(await getLastSyncRun(`relnudge:${p.id}`), now, RENUDGE_DAYS)) continue;
    if (within(await getLastSyncRun(`relsnooze:${p.id}`), now, DISMISS_DAYS)) continue;

    const days = daysSince(p.last_activity, now) ?? 0;
    const weeks = Math.max(1, Math.round(days / 7));

    // No individual Telegram nudge — stage a ready-to-send check-in draft (when
    // we have a contact address) and surface it on the /review page instead.
    if (p.email) {
      const draft = await draftCheckIn(p.full_name, weeks, p.notes ?? null);
      if (draft) {
        await stagePendingChase(owner, {
          commitmentId: "",
          direction: "by_dean",
          personName: p.full_name,
          personEmail: p.email,
          businessKey: "jic",
          subject: `Checking in`,
          draft,
        });
      }
    }
    await recordSyncRun({ userId: owner.user.id, sourceSystem: `relnudge:${p.id}`, stats: { name: p.full_name } });
    sent++;
  }
  return { sent, scanned };
}
