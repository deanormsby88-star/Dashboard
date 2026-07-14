import { randomUUID } from "node:crypto";
import {
  ensureOwner,
  getLastSyncRun,
  listSyncRunsBySource,
  recordSyncRun,
} from "@/lib/db/repo";
import { sendToDean } from "@/lib/telegram/notify";
import { messageTeammate } from "@/lib/teams/send";

/**
 * Ad-hoc, conversational reminders: Dean tells the bot "remind me to call the
 * plumber at 3pm" and gets a Telegram message at that time. Stored on
 * sync_runs (source_system 'reminder:pending') so no schema migration is
 * needed; a fire marker ('reminder:fired:<id>') records delivery/cancellation
 * so each reminder fires exactly once.
 */

const PENDING = "reminder:pending";
const firedKey = (id: string) => `reminder:fired:${id}`;

export interface PendingReminder {
  id: string;
  text: string;
  at: string; // UTC ISO
  recipientEmail?: string; // if set, reminder is sent to this teammate via Teams
  recipientName?: string;
}

function fmtLocal(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Schedule a reminder. `atIso` must be a valid future UTC timestamp. Pass a
 *  recipient to send it to a teammate on Teams instead of Dean on Telegram. */
export async function createReminder(
  text: string,
  atIso: string,
  now: Date = new Date(),
  recipient?: { email: string; name?: string }
): Promise<{ ok: boolean; error?: string; id?: string; when?: string }> {
  const at = new Date(atIso);
  if (Number.isNaN(at.getTime())) return { ok: false, error: "invalid time" };
  if (at.getTime() <= now.getTime()) return { ok: false, error: "that time is in the past" };
  if (!text.trim()) return { ok: false, error: "nothing to remind about" };

  const owner = await ensureOwner();
  const id = randomUUID();
  await recordSyncRun({
    userId: owner.user.id,
    sourceSystem: PENDING,
    stats: {
      id,
      text: text.trim(),
      at: at.toISOString(),
      ...(recipient ? { recipientEmail: recipient.email, recipientName: recipient.name } : {}),
    },
  });
  return { ok: true, id, when: fmtLocal(at.toISOString()) };
}

/** Upcoming reminders not yet fired or cancelled, soonest first. */
export async function listUpcomingReminders(now: Date = new Date()): Promise<
  Array<PendingReminder & { when: string }>
> {
  const rows = await listSyncRunsBySource(PENDING);
  const seen = new Set<string>();
  const out: Array<PendingReminder & { when: string }> = [];
  for (const r of rows) {
    const s = r.stats as Partial<PendingReminder>;
    if (!s.id || !s.at || !s.text || seen.has(s.id)) continue;
    seen.add(s.id);
    if (new Date(s.at).getTime() <= now.getTime()) continue; // past → handled by fire loop
    if (await getLastSyncRun(firedKey(s.id))) continue; // already delivered/cancelled
    out.push({ id: s.id, text: s.text, at: s.at, when: fmtLocal(s.at) });
  }
  return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** Cancel a scheduled reminder by id (marks it fired so it won't deliver). */
export async function cancelReminder(id: string): Promise<boolean> {
  const owner = await ensureOwner();
  if (await getLastSyncRun(firedKey(id))) return false;
  await recordSyncRun({ userId: owner.user.id, sourceSystem: firedKey(id), stats: { cancelled: true } });
  return true;
}

/** Deliver every due, unfired reminder via Telegram. Called by the cron. */
export async function fireDueReminders(now: Date = new Date()): Promise<{ fired: number; pending: number }> {
  const owner = await ensureOwner();
  const rows = await listSyncRunsBySource(PENDING);
  const seen = new Set<string>();
  let fired = 0;
  let pending = 0;
  for (const r of rows) {
    const s = r.stats as Partial<PendingReminder>;
    if (!s.id || !s.at || !s.text || seen.has(s.id)) continue;
    seen.add(s.id);
    if (new Date(s.at).getTime() > now.getTime()) {
      pending++;
      continue; // not yet due
    }
    if (await getLastSyncRun(firedKey(s.id))) continue; // already delivered/cancelled
    let ok: boolean;
    if (s.recipientEmail) {
      const first = (s.recipientName ?? "").split(" ")[0] || "there";
      const res = await messageTeammate(s.recipientEmail, `Hi ${first}, quick reminder: ${s.text}\n\nThanks, Dean`);
      ok = res.ok;
    } else {
      ok = await sendToDean(`⏰ Reminder: ${s.text}`);
    }
    if (ok) {
      await recordSyncRun({ userId: owner.user.id, sourceSystem: firedKey(s.id), stats: { delivered: true } });
      fired++;
    }
  }
  return { fired, pending };
}
