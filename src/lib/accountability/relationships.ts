import {
  appendConversationMessage,
  getLastSyncRun,
  listPeopleWithCounts,
  recordSyncRun,
} from "@/lib/db/repo";
import { sendToUserWithButtons } from "@/lib/telegram/notify";
import { draftCheckIn, stagePendingChase } from "@/lib/accountability/chase";
import type { Owner } from "@/lib/db/repo";
import type { InlineButton } from "@/lib/telegram/api";

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
    const org = p.organization ? ` · ${p.organization}` : "";
    const openItems = p.open_to_dean + p.open_by_dean;

    const lines = [`👋 You've gone quiet with ${p.full_name}${org}`];
    lines.push(`Last activity ~${weeks} week(s) ago.`);
    if (openItems > 0) lines.push(`You still have ${openItems} open item(s) together.`);

    const buttons: InlineButton[][] = [];
    if (p.email) {
      const draft = await draftCheckIn(p.full_name, weeks, p.notes ?? null);
      if (draft) {
        const chaseId = await stagePendingChase(owner, {
          commitmentId: "",
          direction: "by_dean",
          personName: p.full_name,
          personEmail: p.email,
          businessKey: "heya",
          subject: `Checking in`,
          draft,
        });
        lines.push(`\nDraft check-in ready:\n“${draft}”`);
        buttons.push([
          { text: "📤 Send via Teams", callback_data: `loop:teams:${chaseId}` },
          { text: "✉️ Email", callback_data: `loop:email:${chaseId}` },
        ]);
      }
    }
    buttons.push([{ text: "💤 Not now", callback_data: `loop:dismiss:${p.id}` }]);

    const msg = lines.join("\n");
    const ok = await sendToUserWithButtons(owner.user.id, msg, buttons);
    if (ok) {
      await recordSyncRun({ userId: owner.user.id, sourceSystem: `relnudge:${p.id}`, stats: { name: p.full_name } });
      await appendConversationMessage({ userId: owner.user.id, channel: "telegram", role: "assistant", content: msg });
      sent++;
    }
  }
  return { sent, scanned };
}
