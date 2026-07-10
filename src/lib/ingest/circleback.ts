import { getEnv } from "@/lib/env";
import {
  normalizeCirclebackPayload,
  parseMeetingDate,
} from "@/lib/circleback/schema";
import {
  IDEMPOTENCY_HEADER,
  SECRET_HEADER,
  TIMESTAMP_HEADER,
  deriveIdempotencyKey,
  isTimestampFresh,
  verifySharedSecret,
} from "@/lib/webhooks/security";
import {
  ensureOwner,
  recordWebhookEvent,
  replaceMeetingAttendees,
  updateWebhookEvent,
  upsertMeeting,
  upsertSourceRecord,
} from "@/lib/db/repo";
import { processMeeting } from "@/lib/processors/meeting";

export const CIRCLEBACK_ENDPOINT = "zapier/circleback";

export interface IngestResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface IngestHeaders {
  get(name: string): string | null;
}

/**
 * Full Circleback ingestion pipeline. Every request that passes
 * authentication is recorded in webhook_events — including invalid payloads —
 * so nothing is ever silently dropped.
 */
export async function ingestCircleback(
  headers: IngestHeaders,
  rawBody: string
): Promise<IngestResponse> {
  const env = getEnv();

  // 1. Authentication. Unauthenticated requests are NOT stored (they are
  //    noise/probing, not lost events) — everything after this point is.
  if (!verifySharedSecret(headers.get(SECRET_HEADER), env.ZAPIER_WEBHOOK_SECRET)) {
    return { status: 401, body: { error: "Invalid or missing webhook secret." } };
  }
  if (!isTimestampFresh(headers.get(TIMESTAMP_HEADER))) {
    return { status: 401, body: { error: "Stale or invalid timestamp — possible replay." } };
  }

  // 2. Parse JSON (still recorded on failure).
  let payload: unknown = null;
  let parseError: string | null = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    parseError = "Request body is not valid JSON.";
  }

  // 3. Idempotency / replay absorption.
  const idempotencyKey = deriveIdempotencyKey(
    CIRCLEBACK_ENDPOINT,
    headers.get(IDEMPOTENCY_HEADER),
    rawBody
  );
  const event = await recordWebhookEvent({
    endpoint: CIRCLEBACK_ENDPOINT,
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

  // 4. Validate/normalize the payload shape.
  const normalized = normalizeCirclebackPayload(payload);
  if (!normalized.ok || !normalized.payload) {
    const error = normalized.error ?? "Invalid payload.";
    await updateWebhookEvent(event.id, "failed", error);
    return { status: 422, body: { error, webhookEventId: event.id } };
  }
  const meetingPayload = normalized.payload;

  try {
    // 5. Store raw source record + meeting.
    const owner = await ensureOwner();
    await upsertSourceRecord({
      userId: owner.user.id,
      sourceSystem: "circleback",
      sourceRecordId: meetingPayload.meetingId,
      payload,
    });
    const { meeting } = await upsertMeeting({
      userId: owner.user.id,
      sourceSystem: "circleback",
      sourceRecordId: meetingPayload.meetingId,
      sourceUrl: meetingPayload.sourceUrl,
      title: meetingPayload.title,
      meetingDate: parseMeetingDate(meetingPayload.meetingDate),
      notes: meetingPayload.notes,
      transcript: meetingPayload.transcript,
    });
    await replaceMeetingAttendees(
      meeting.id,
      meetingPayload.attendees.map((a) => ({ name: a.name ?? null, email: a.email ?? null }))
    );

    // 6. Run the Meeting Processor inline. A processing failure is not an
    //    ingestion failure: the meeting is stored and retryable from the UI.
    const result = await processMeeting(meeting.id);

    await updateWebhookEvent(event.id, "processed");
    return {
      status: 200,
      body: {
        ok: true,
        meetingId: meeting.id,
        processing: result.ok
          ? { status: "processed", counts: result.counts }
          : { status: "failed", error: result.error },
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateWebhookEvent(event.id, "failed", message);
    return { status: 500, body: { error: message, webhookEventId: event.id } };
  }
}
