import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import {
  IDEMPOTENCY_HEADER,
  SECRET_HEADER,
  deriveIdempotencyKey,
  verifySharedSecret,
} from "@/lib/webhooks/security";
import {
  completeTaskByTodoistId,
  markTaskCreatedByDedupKey,
  recordWebhookEvent,
  updateWebhookEvent,
} from "@/lib/db/repo";

export const runtime = "nodejs";

const ENDPOINT = "zapier/todoist";

/**
 * Callback from Zapier after it executes a Todoist action. For "created",
 * stores the Todoist task ID and URL against the DeanOS task, matched by
 * deanos_task_id or dedup_key (Phase 1 acceptance criterion 10).
 */
const callbackSchema = z.object({
  action: z.enum(["created", "completed"]),
  deanos_task_id: z.string().uuid().nullish(),
  dedup_key: z.string().nullish(),
  todoist_task_id: z.union([z.string(), z.number()]).transform(String),
  todoist_task_url: z.string().nullish(),
});

export async function POST(request: NextRequest) {
  const env = getEnv();
  if (!verifySharedSecret(request.headers.get(SECRET_HEADER), env.ZAPIER_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Invalid or missing webhook secret." }, { status: 401 });
  }

  const rawBody = await request.text();
  const idempotencyKey = deriveIdempotencyKey(
    ENDPOINT,
    request.headers.get(IDEMPOTENCY_HEADER),
    rawBody
  );

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // recorded below as failed
  }

  const event = await recordWebhookEvent({
    endpoint: ENDPOINT,
    idempotencyKey,
    payload,
    rawBody: payload === null ? rawBody.slice(0, 100_000) : null,
  });
  if (event.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const parsed = callbackSchema.safeParse(payload);
  if (!parsed.success) {
    const error = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    await updateWebhookEvent(event.id, "failed", error);
    return NextResponse.json({ error, webhookEventId: event.id }, { status: 422 });
  }

  const body = parsed.data;
  try {
    if (body.action === "created") {
      const task = await markTaskCreatedByDedupKey({
        taskId: body.deanos_task_id ?? null,
        dedupKey: body.dedup_key ?? null,
        todoistTaskId: body.todoist_task_id,
        todoistTaskUrl: body.todoist_task_url ?? null,
      });
      if (!task) {
        const error = "No matching DeanOS task for callback (deanos_task_id / dedup_key not found).";
        await updateWebhookEvent(event.id, "failed", error);
        return NextResponse.json({ error, webhookEventId: event.id }, { status: 404 });
      }
      await updateWebhookEvent(event.id, "processed");
      return NextResponse.json({ ok: true, taskId: task.id, status: task.status });
    }

    // action === "completed" — Todoist-side completion reflected back.
    const task = await completeTaskByTodoistId(body.todoist_task_id);
    await updateWebhookEvent(event.id, task ? "processed" : "failed", task ? null : "No task with that Todoist ID.");
    return NextResponse.json({ ok: true, matched: Boolean(task) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateWebhookEvent(event.id, "failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
