import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getWebhookEvent, updateWebhookEvent } from "@/lib/db/repo";
import { ingestCircleback, CIRCLEBACK_ENDPOINT } from "@/lib/ingest/circleback";
import { ingestEmail, EMAIL_ENDPOINT } from "@/lib/ingest/email";
import { getEnv } from "@/lib/env";
import { IDEMPOTENCY_HEADER, SECRET_HEADER } from "@/lib/webhooks/security";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Re-run ingestion for a stored (typically failed) webhook event using the
 * preserved raw payload. Replays through the same pipeline with a retry
 * idempotency key so the original event row isn't shadowed.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const event = await getWebhookEvent(params.id);
  if (!event) return NextResponse.json({ error: "Webhook event not found." }, { status: 404 });

  const ingest =
    event.endpoint === CIRCLEBACK_ENDPOINT
      ? ingestCircleback
      : event.endpoint === EMAIL_ENDPOINT
        ? ingestEmail
        : null;
  if (!ingest) {
    return NextResponse.json(
      { error: `Retry is not supported for endpoint ${event.endpoint}.` },
      { status: 400 }
    );
  }

  const rawBody = event.raw_body ?? (event.payload != null ? JSON.stringify(event.payload) : null);
  if (!rawBody) {
    return NextResponse.json({ error: "No stored payload to retry." }, { status: 400 });
  }

  const headers = new Headers({
    [SECRET_HEADER]: getEnv().ZAPIER_WEBHOOK_SECRET,
    [IDEMPOTENCY_HEADER]: `retry:${event.id}:${Date.now()}`,
  });
  const result = await ingest(headers, rawBody);

  if (result.status === 200) {
    await updateWebhookEvent(event.id, "processed", "Resolved by manual retry.");
  }
  return NextResponse.json(result.body, { status: result.status });
}
