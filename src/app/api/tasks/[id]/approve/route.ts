import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { ensureOwner, getTask, markTaskCreatedByDedupKey, setTaskStatus } from "@/lib/db/repo";
import { executeCreate } from "@/lib/todoist/execute";

export const runtime = "nodejs";

/**
 * Approve a suggested task and create it in Todoist — directly via the
 * Todoist API when configured (status jumps straight to 'created' with the
 * task ID), otherwise via the Zapier hook (status 'sent' until the callback).
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const task = await getTask(params.id);
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  if (!["suggested", "approved", "failed"].includes(task.status)) {
    return NextResponse.json(
      { error: `Task is '${task.status}' — only suggested, approved or failed tasks can be dispatched.` },
      { status: 409 }
    );
  }

  await setTaskStatus(task.id, "approved");

  const owner = await ensureOwner();
  const business = owner.businesses.find((b) => b.id === task.business_id) ?? null;
  const result = await executeCreate(task, business);

  if (!result.ok) {
    const updated = await setTaskStatus(task.id, "failed", result.error);
    return NextResponse.json({ error: result.error, task: updated }, { status: 502 });
  }

  if (result.created) {
    const updated = await markTaskCreatedByDedupKey({
      taskId: task.id,
      todoistTaskId: result.created.todoistTaskId,
      todoistTaskUrl: result.created.todoistTaskUrl,
    });
    return NextResponse.json({ ok: true, task: updated });
  }

  const updated = await setTaskStatus(task.id, "sent");
  return NextResponse.json({ ok: true, task: updated });
}
