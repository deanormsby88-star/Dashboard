import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import {
  completeTaskByTodoistId,
  getCommitment,
  getTask,
  setTaskStatus,
  updateCommitment,
} from "@/lib/db/repo";
import { executeComplete } from "@/lib/todoist/execute";

export const runtime = "nodejs";

const patchSchema = z.object({
  text: z.string().min(1).max(1000).optional(),
  person: z.string().max(200).nullable().optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  status: z.enum(["open", "done", "cancelled"]).optional(),
});

/**
 * Edit a commitment (either direction) or change its status. Resolving a
 * commitment (done/cancelled) also tidies up its linked follow-up task:
 * a still-suggested task is rejected; a task already created in Todoist is
 * completed there.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const commitment = await getCommitment(params.id);
  if (!commitment) return NextResponse.json({ error: "Commitment not found." }, { status: 404 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const updated = await updateCommitment(commitment.id, {
    text: data.text,
    personName: data.person,
    dueDate: data.due_date,
    status: data.status,
  });

  // On resolution, deal with the linked follow-up task.
  const resolving = data.status === "done" || data.status === "cancelled";
  if (resolving && commitment.linked_task_id) {
    const task = await getTask(commitment.linked_task_id);
    if (task?.status === "suggested" || task?.status === "approved") {
      await setTaskStatus(task.id, "rejected", "Commitment resolved in DeanOS — follow-up no longer needed.");
    } else if (task?.status === "created" && task.todoist_task_id) {
      const done = await executeComplete(task.todoist_task_id);
      if (done.ok) await completeTaskByTodoistId(task.todoist_task_id);
    }
  }

  return NextResponse.json({ ok: true, commitment: updated });
}
