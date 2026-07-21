import { getEnv } from "@/lib/env";
import { callStructured } from "@/lib/ai/openai";
import { ensureOwner, getLastSyncRun, listSyncRunsBySource, recordSyncRun } from "@/lib/db/repo";

/**
 * Deadline handling for suggested-task approval. Dean picks Today / Tomorrow /
 * a specific date on the Telegram card; the choice becomes the task's Todoist
 * Deadline. "Pick a date" parks a pending slot so his next reply is read as the
 * date.
 */

const AWAIT_SOURCE = "taskdeadline:await";
const CONSUMED_SOURCE = "taskdeadline:consumed";
/** How long a "reply with the date" prompt stays live before we stop hijacking replies. */
const AWAIT_TTL_MS = 60 * 60_000;

/** Calendar date in Africa/Johannesburg (UTC+2, no DST), offset by whole days. */
export function localDateSAST(offsetDays = 0, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + 2 * 3600_000 + offsetDays * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Resolve a free-text phrase to a YYYY-MM-DD deadline (Dean's timezone).
 * Handles ISO and DD/MM/YYYY directly; today/tomorrow; and falls back to the
 * model for relative phrases ("next Friday", "end of month"). Returns null when
 * the text isn't a date, so callers can treat that as "not a deadline reply".
 */
export async function resolveDeadlineDate(text: string, now: Date = new Date()): Promise<string | null> {
  const t = text.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  // DD/MM/YYYY or DD-MM-YYYY (South African day-first convention).
  const dmy = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const d = Number(dmy[1]);
    const mo = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  if (/^today$/i.test(t)) return localDateSAST(0, now);
  if (/^(tomorrow|tmrw|tmr)$/i.test(t)) return localDateSAST(1, now);

  // Too long to plausibly be a bare date phrase → treat as a normal message.
  if (t.length > 40) return null;

  const today = localDateSAST(0, now);
  const res = await callStructured({
    model: getEnv().OPENAI_MODEL_PRIORITIZER,
    system:
      "Resolve the user's phrase to a single calendar date in YYYY-MM-DD, in the Africa/Johannesburg timezone. " +
      `Today is ${today}. Relative phrases ("next Friday", "end of month", "in 3 days") resolve against today. ` +
      "If the phrase is not a date at all, return null. Output only the JSON.",
    user: t,
    schemaName: "deadline_date",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["date"],
      properties: { date: { type: ["string", "null"], description: "YYYY-MM-DD or null" } },
    },
    maxOutputTokens: 60,
  });
  if (!res.ok || !res.rawText) return null;
  try {
    const parsed = JSON.parse(res.rawText) as { date?: string | null };
    if (parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) return parsed.date;
  } catch {
    /* not parseable → not a date */
  }
  return null;
}

/** Park a "reply with the deadline date" request for this task. */
export async function setAwaitingDeadline(taskId: string, title: string): Promise<void> {
  const owner = await ensureOwner();
  await recordSyncRun({ userId: owner.user.id, sourceSystem: AWAIT_SOURCE, stats: { taskId, title } });
}

/** The currently-awaited deadline request, if one is live (and not consumed/stale). */
export async function getAwaitingDeadline(now: Date = new Date()): Promise<{ taskId: string; title: string } | null> {
  const rows = await listSyncRunsBySource(AWAIT_SOURCE, 1);
  const latest = rows[0];
  if (!latest) return null;
  if (now.getTime() - new Date(latest.started_at).getTime() > AWAIT_TTL_MS) return null;
  const consumedAt = await getLastSyncRun(CONSUMED_SOURCE);
  if (consumedAt && new Date(consumedAt).getTime() >= new Date(latest.started_at).getTime()) return null;
  const taskId = typeof latest.stats?.taskId === "string" ? latest.stats.taskId : null;
  if (!taskId) return null;
  return { taskId, title: typeof latest.stats?.title === "string" ? latest.stats.title : "task" };
}

/** Mark the awaited deadline request as handled (so it won't hijack later replies). */
export async function clearAwaitingDeadline(): Promise<void> {
  const owner = await ensureOwner();
  await recordSyncRun({ userId: owner.user.id, sourceSystem: CONSUMED_SOURCE, stats: {} });
}
