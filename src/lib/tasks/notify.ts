import { ensureOwner, getLastSyncRun, listTasks, recordSyncRun } from "@/lib/db/repo";
import { sendToDeanWithButtons } from "@/lib/telegram/notify";

const PRIORITY_LABEL: Record<number, string> = { 4: "urgent", 3: "important", 2: "normal", 1: "backlog" };

/**
 * Push each newly-suggested task to Telegram with Approve/Reject buttons, once.
 * Dedup via sync_runs (`tasknotify:<id>`) so a task is only sent for review one
 * time. Called by the notify-tasks cron.
 */
export async function notifyPendingTasks(): Promise<{ sent: number; pending: number }> {
  const owner = await ensureOwner();
  const tasks = await listTasks({ status: "suggested" });

  let sent = 0;
  for (const t of tasks) {
    const key = `tasknotify:${t.id}`;
    if (await getLastSyncRun(key)) continue;

    const business = owner.businesses.find((b) => b.id === t.business_id)?.name ?? "Inbox";
    const meta = [business, PRIORITY_LABEL[t.priority] ?? "normal", t.due_date ? `due ${String(t.due_date).slice(0, 10)}` : null]
      .filter(Boolean)
      .join(" · ");
    const lines = [`🆕 Task to approve`, `“${t.title}”`, meta];
    if (t.description && t.description !== "Captured via chat.") lines.push(t.description);
    lines.push("", "Approve with a deadline:");
    // Approving picks the Todoist deadline in one tap. "Pick a date" asks Dean
    // to reply with a date; "No deadline" approves without one.
    const ok = await sendToDeanWithButtons(lines.join("\n"), [
      [
        { text: "📅 Today", callback_data: `task:today:${t.id}` },
        { text: "📅 Tomorrow", callback_data: `task:tmrw:${t.id}` },
      ],
      [
        { text: "🗓 Pick a date", callback_data: `task:date:${t.id}` },
        { text: "✅ No deadline", callback_data: `task:approve:${t.id}` },
      ],
      [{ text: "❌ Reject", callback_data: `task:reject:${t.id}` }],
    ]);
    if (ok) {
      await recordSyncRun({ userId: owner.user.id, sourceSystem: key, stats: { title: t.title } });
      sent++;
    }
  }
  return { sent, pending: tasks.length };
}
