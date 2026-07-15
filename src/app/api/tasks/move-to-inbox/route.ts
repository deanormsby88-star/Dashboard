import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { ensureOwner, listTasks } from "@/lib/db/repo";
import { getInboxProjectId, moveTodoistTask, updateTodoistTask } from "@/lib/todoist/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sweep DeanOS-created Todoist tasks out of the per-business projects and into
 * the Inbox, tagging each with its business label. Safe to re-run (moving a
 * task already in the Inbox is a no-op).
 */
export async function POST() {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const inboxId = await getInboxProjectId();
  if (!inboxId) return NextResponse.json({ error: "Couldn't find the Todoist Inbox." }, { status: 502 });

  const owner = await ensureOwner();
  const tasks = (await listTasks({ status: "created" })).filter((t) => t.todoist_task_id);

  let moved = 0;
  let failed = 0;
  for (const t of tasks) {
    const business = owner.businesses.find((b) => b.id === t.business_id);
    const res = await moveTodoistTask(t.todoist_task_id!, inboxId);
    if (!res.ok) {
      failed++;
      continue;
    }
    if (business?.name) {
      const labels = Array.from(new Set([...(t.labels ?? []), business.name]));
      await updateTodoistTask(t.todoist_task_id!, { labels }).catch(() => {});
    }
    moved++;
  }
  return NextResponse.json({ ok: true, moved, failed, total: tasks.length });
}
