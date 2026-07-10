import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { ensureOwner, getTask, setTaskStatus } from "@/lib/db/repo";
import { buildCreateRequest, sendTodoistCreate } from "@/lib/todoist/zapier";

export const runtime = "nodejs";

/**
 * Approve a suggested task and dispatch it to Todoist via the Zapier create
 * hook. Status flow: suggested → approved → sent → created (via callback),
 * or → failed with a human-readable error and a retry path (approve again).
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
  const result = await sendTodoistCreate(buildCreateRequest(task, business));

  if (!result.ok) {
    const updated = await setTaskStatus(task.id, "failed", result.error);
    return NextResponse.json({ error: result.error, task: updated }, { status: 502 });
  }

  const updated = await setTaskStatus(task.id, "sent");
  return NextResponse.json({ ok: true, task: updated });
}
