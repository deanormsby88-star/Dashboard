import { getEnv } from "@/lib/env";
import { normalizeEmailPayload, parseEmailDate } from "@/lib/email/schema";
import {
  IDEMPOTENCY_HEADER,
  SECRET_HEADER,
  TIMESTAMP_HEADER,
  deriveIdempotencyKey,
  isTimestampFresh,
  verifySharedSecret,
} from "@/lib/webhooks/security";
import {
  businessByKey,
  ensureOwner,
  recordWebhookEvent,
  updateWebhookEvent,
  upsertEmail,
  upsertSourceRecord,
} from "@/lib/db/repo";
import { processEmail } from "@/lib/processors/email";
import type { IngestHeaders, IngestResponse } from "@/lib/ingest/circleback";

export const EMAIL_ENDPOINT = "zapier/email";

/**
 * Email ingestion pipeline — same guarantees as Circleback ingestion:
 * authenticated events are always recorded, replays are absorbed, processing
 * failures leave the email stored and retryable.
 */
export async function ingestEmail(
  headers: IngestHeaders,
  rawBody: string
): Promise<IngestResponse> {
  const env = getEnv();

  if (!verifySharedSecret(headers.get(SECRET_HEADER), env.ZAPIER_WEBHOOK_SECRET)) {
    return { status: 401, body: { error: "Invalid or missing webhook secret." } };
  }
  if (!isTimestampFresh(headers.get(TIMESTAMP_HEADER))) {
    return { status: 401, body: { error: "Stale or invalid timestamp — possible replay." } };
  }

  let payload: unknown = null;
  let parseError: string | null = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    parseError = "Request body is not valid JSON.";
  }

  const idempotencyKey = deriveIdempotencyKey(
    EMAIL_ENDPOINT,
    headers.get(IDEMPOTENCY_HEADER),
    rawBody
  );
  const event = await recordWebhookEvent({
    endpoint: EMAIL_ENDPOINT,
    idempotencyKey,
    payload,
    rawBody: payload === null ? rawBody.slice(0, 100_000) : null,
  });
  if (event.duplicate) {
    return {
      status: 200,
      body: { ok: true, duplicate: true, message: "Event already received; ignored." },
    };
  }

  if (parseError) {
    await updateWebhookEvent(event.id, "failed", parseError);
    return { status: 400, body: { error: parseError, webhookEventId: event.id } };
  }

  const normalized = normalizeEmailPayload(payload);
  if (!normalized.ok || !normalized.payload) {
    const error = normalized.error ?? "Invalid payload.";
    await updateWebhookEvent(event.id, "failed", error);
    return { status: 422, body: { error, webhookEventId: event.id } };
  }
  const p = normalized.payload;

  try {
    const owner = await ensureOwner();
    await upsertSourceRecord({
      userId: owner.user.id,
      sourceSystem: `email:${p.mailbox}`,
      sourceRecordId: p.messageId,
      payload,
    });
    const business = businessByKey(owner, p.mailbox);
    const { email, created } = await upsertEmail({
      userId: owner.user.id,
      businessId: business?.id ?? null,
      mailbox: p.mailbox,
      direction: p.direction,
      sender: p.sender,
      recipients: p.recipients,
      subject: p.subject,
      bodyText: p.bodyText,
      emailDate: parseEmailDate(p.emailDate),
      threadId: p.threadId,
      messageId: p.messageId,
      sourceUrl: p.sourceUrl,
      flags: p.flags,
      attachments: p.attachments,
    });

    // An email we've already processed (e.g. flagged twice) is not re-run.
    if (!created && email.processing_status === "processed") {
      await updateWebhookEvent(event.id, "duplicate");
      return {
        status: 200,
        body: { ok: true, duplicate: true, message: "Email already processed; ignored." },
      };
    }

    const result = await processEmail(email.id);
    await updateWebhookEvent(event.id, "processed");
    return {
      status: 200,
      body: {
        ok: true,
        emailId: email.id,
        processing: result.ok
          ? { status: "processed", classification: result.classification, counts: result.counts }
          : { status: "failed", error: result.error },
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateWebhookEvent(event.id, "failed", message);
    return { status: 500, body: { error: message, webhookEventId: event.id } };
  }
}
