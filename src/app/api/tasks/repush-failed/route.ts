import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { ensureOwner, listTasks, markTaskCreatedByDedupKey, setTaskStatus } from "@/lib/db/repo";
import { executeCreate } from "@/lib/todoist/execute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-push tasks that previously failed to reach Todoist (e.g. the stale
 * project-id bug). Failed tasks never landed in Todoist, so re-creating them
 * can't duplicate. Safe to re-run.
 */
export async function POST() {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const owner = await ensureOwner();
  const failed = await listTasks({ status: "failed" });

  let repushed = 0;
  let stillFailing = 0;
  const errors: string[] = [];
  for (const task of failed) {
    const business = owner.businesses.find((b) => b.id === task.business_id) ?? null;
    const sent = await executeCreate(task, business);
    if (!sent.ok) {
      await setTaskStatus(task.id, "failed", sent.error);
      stillFailing++;
      if (sent.error) errors.push(`${task.title}: ${sent.error}`);
      continue;
    }
    if (sent.created) {
      await markTaskCreatedByDedupKey({
        taskId: task.id,
        todoistTaskId: sent.created.todoistTaskId,
        todoistTaskUrl: sent.created.todoistTaskUrl,
      });
    } else {
      await setTaskStatus(task.id, "sent");
    }
    repushed++;
  }
  return NextResponse.json({ ok: true, repushed, stillFailing, errors: errors.slice(0, 5) });
}
