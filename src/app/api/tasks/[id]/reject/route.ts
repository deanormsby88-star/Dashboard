import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getTask, setTaskStatus } from "@/lib/db/repo";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const task = await getTask(params.id);
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  if (task.status !== "suggested" && task.status !== "failed") {
    return NextResponse.json(
      { error: `Task is '${task.status}' — only suggested or failed tasks can be rejected.` },
      { status: 409 }
    );
  }
  const updated = await setTaskStatus(task.id, "rejected");
  return NextResponse.json({ ok: true, task: updated });
}
