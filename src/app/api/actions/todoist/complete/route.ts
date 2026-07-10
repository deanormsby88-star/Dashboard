import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { completeTaskByTodoistId } from "@/lib/db/repo";
import { executeComplete } from "@/lib/todoist/execute";

export const runtime = "nodejs";

const bodySchema = z.object({
  todoist_task_id: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "todoist_task_id is required." }, { status: 400 });
  }

  const result = await executeComplete(parsed.data.todoist_task_id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  // Reflect locally right away; the Zapier callback is the authoritative echo.
  await completeTaskByTodoistId(parsed.data.todoist_task_id);
  return NextResponse.json({ ok: true });
}
