import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { getTask, setTaskStatus } from "@/lib/db/repo";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;

  const task = await getTask(owner.user.id, params.id);
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  if (task.status !== "suggested" && task.status !== "failed") {
    return NextResponse.json(
      { error: `Task is '${task.status}' — only suggested or failed tasks can be rejected.` },
      { status: 409 }
    );
  }
  const updated = await setTaskStatus(owner.user.id, task.id, "rejected");
  return NextResponse.json({ ok: true, task: updated });
}
