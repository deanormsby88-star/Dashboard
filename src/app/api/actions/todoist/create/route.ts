import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { requireSession } from "@/lib/auth/require-session";
import { businessByKey, ensureOwner, insertTask, markTaskCreatedByDedupKey, setTaskStatus } from "@/lib/db/repo";
import { normalizeTitle } from "@/lib/dedup";
import { executeCreate } from "@/lib/todoist/execute";

export const runtime = "nodejs";

/**
 * Generic Todoist-create action endpoint (brief §19). Creates a DeanOS task
 * record (manual origin, pre-approved) and forwards it to the Zapier create
 * hook. Structured per the brief: title, project via business, description,
 * priority, explicit due date only, labels, source fields, dedup key.
 */
const bodySchema = z.object({
  title: z.string().min(1).max(500),
  business: z.enum(["heya", "jic", "personal"]),
  description: z.string().max(5000).default(""),
  priority: z.number().int().min(1).max(4).default(2),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  labels: z.array(z.string()).default([]),
  source_system: z.string().default("manual"),
  source_record_id: z.string().nullable().default(null),
  source_url: z.string().nullable().default(null),
  dedup_key: z.string().nullable().default(null),
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
  const body = parsed.data;

  const owner = await ensureOwner();
  const business = businessByKey(owner, body.business);
  const dedupKey =
    body.dedup_key ??
    createHash("sha256")
      .update(`manual:${body.source_system}:${body.source_record_id ?? ""}:${normalizeTitle(body.title)}`)
      .digest("hex");

  const { task, duplicate } = await insertTask({
    userId: owner.user.id,
    businessId: business?.id ?? null,
    meetingId: null,
    title: body.title,
    description: body.description,
    priority: body.priority,
    dueDate: body.due_date,
    labels: body.labels,
    origin: "manual",
    confidence: null,
    sourceSystem: body.source_system,
    sourceRecordId: body.source_record_id,
    sourceUrl: body.source_url,
    dedupKey,
    aiRunId: null,
  });
  if (duplicate || !task) {
    return NextResponse.json(
      { error: "A task with this dedup key already exists.", duplicate: true },
      { status: 409 }
    );
  }

  const result = await executeCreate(task, business);
  if (!result.ok) {
    const failed = await setTaskStatus(task.id, "failed", result.error);
    return NextResponse.json({ error: result.error, task: failed }, { status: 502 });
  }
  if (result.created) {
    const created = await markTaskCreatedByDedupKey({
      taskId: task.id,
      todoistTaskId: result.created.todoistTaskId,
      todoistTaskUrl: result.created.todoistTaskUrl,
    });
    return NextResponse.json({ ok: true, task: created });
  }
  const sent = await setTaskStatus(task.id, "sent");
  return NextResponse.json({ ok: true, task: sent });
}
