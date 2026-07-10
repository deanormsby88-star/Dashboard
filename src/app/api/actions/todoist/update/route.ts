import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { executeUpdate } from "@/lib/todoist/execute";

export const runtime = "nodejs";

const bodySchema = z.object({
  todoist_task_id: z.string().min(1),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  priority: z.number().int().min(1).max(4).optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  project_id: z.string().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }

  const { todoist_task_id, ...fields } = parsed.data;
  const result = await executeUpdate({ todoistTaskId: todoist_task_id, ...fields });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
