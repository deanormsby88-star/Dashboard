import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { ensureOwner, getTask, updateTaskFields } from "@/lib/db/repo";

export const runtime = "nodejs";

/** Edit a suggested task before approving it. */
const patchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  priority: z.number().int().min(1).max(4).optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  labels: z.array(z.string()).optional(),
  business: z.enum(["heya", "jic", "personal"]).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const task = await getTask(params.id);
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  if (!["suggested", "approved", "failed"].includes(task.status)) {
    return NextResponse.json(
      { error: `Task is '${task.status}' — edit it in Todoist instead.` },
      { status: 409 }
    );
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }

  let businessId: string | null | undefined;
  if (parsed.data.business) {
    const owner = await ensureOwner();
    businessId = owner.businesses.find((b) => b.key === parsed.data.business)?.id ?? null;
  }

  const updated = await updateTaskFields(task.id, {
    title: parsed.data.title,
    description: parsed.data.description,
    priority: parsed.data.priority,
    dueDate: parsed.data.due_date,
    labels: parsed.data.labels,
    businessId,
  });
  return NextResponse.json({ ok: true, task: updated });
}
