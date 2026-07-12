import { ensureOwner, getLastSyncRun, recordSyncRun } from "@/lib/db/repo";
import { listActiveTodoistTasks, type TodoistTask } from "@/lib/todoist/api";
import { getEnv } from "@/lib/env";
import { sendToDean } from "@/lib/telegram/notify";

/** Today's date (YYYY-MM-DD) in Dean's timezone. */
export function localToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

export interface DueBuckets {
  overdue: TodoistTask[];
  today: TodoistTask[];
}

/** Split tasks into overdue vs due-today by their due date, relative to `today`. */
export function bucketDueTasks(tasks: TodoistTask[], today: string): DueBuckets {
  const overdue: TodoistTask[] = [];
  const due: TodoistTask[] = [];
  for (const t of tasks) {
    if (!t.due) continue;
    if (t.due.date < today) overdue.push(t);
    else if (t.due.date === today) due.push(t);
  }
  const byPriority = (a: TodoistTask, b: TodoistTask) => b.priority - a.priority;
  return { overdue: overdue.sort(byPriority), today: due.sort(byPriority) };
}

function line(t: TodoistTask): string {
  const flag = t.priority >= 4 ? "🔴 " : t.priority === 3 ? "🟠 " : "";
  return `• ${flag}${t.content}`;
}

export function composeDigest(buckets: DueBuckets): string | null {
  const total = buckets.overdue.length + buckets.today.length;
  if (total === 0) return null;
  const parts = [`✅ Todoist — ${total} due`];
  if (buckets.overdue.length > 0) {
    parts.push(`\nOverdue (${buckets.overdue.length}):\n${buckets.overdue.map((t) => `${line(t)} — was due ${t.due?.date}`).join("\n")}`);
  }
  if (buckets.today.length > 0) {
    parts.push(`\nToday (${buckets.today.length}):\n${buckets.today.map(line).join("\n")}`);
  }
  return parts.join("\n");
}

interface TaskReminderResult {
  status: "sent" | "nothing_due" | "already_sent" | "not_configured";
  count?: number;
}

/**
 * Send Dean a Telegram digest of Todoist tasks due today or overdue. Runs once
 * per local day (dedup via sync_runs), so re-invocations that day are no-ops.
 */
export async function sendTaskReminders(now: Date = new Date()): Promise<TaskReminderResult> {
  if (!getEnv().TODOIST_API_TOKEN) return { status: "not_configured" };
  const owner = await ensureOwner();
  const today = localToday(now);

  const dedupKey = `taskdigest:${today}`;
  const last = await getLastSyncRun(dedupKey);
  if (last) return { status: "already_sent" };

  const tasks = await listActiveTodoistTasks();
  const buckets = bucketDueTasks(tasks, today);
  const message = composeDigest(buckets);
  if (!message) return { status: "nothing_due" };

  const ok = await sendToDean(message);
  if (ok) {
    await recordSyncRun({ userId: owner.user.id, sourceSystem: dedupKey, stats: { count: buckets.overdue.length + buckets.today.length } });
  }
  return { status: "sent", count: buckets.overdue.length + buckets.today.length };
}
