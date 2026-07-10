import { z } from "zod";

/**
 * Circleback payload model.
 *
 * Zapier field mapping is configured by hand, so the normalizer accepts the
 * common naming variants (camelCase, snake_case, Zapier's label-style keys)
 * and coerces list-ish fields that may arrive as newline- or comma-separated
 * strings. The raw payload is always stored verbatim in source_records
 * regardless of what this normalizer does.
 */

const attendeeObject = z
  .object({
    name: z.string().optional(),
    email: z.string().optional(),
  })
  .passthrough();

export const circlebackPayloadSchema = z.object({
  meetingId: z.string().min(1),
  title: z.string().min(1),
  meetingDate: z.string().nullable(),
  attendees: z.array(attendeeObject),
  notes: z.string(),
  transcript: z.string(),
  actionItems: z.array(z.string()),
  sourceUrl: z.string().nullable(),
});

export type CirclebackPayload = z.infer<typeof circlebackPayloadSchema>;

function firstValue(raw: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== "") return raw[key];
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v : typeof v === "object" && v !== null ? asString((v as Record<string, unknown>).text ?? (v as Record<string, unknown>).title ?? (v as Record<string, unknown>).name) ?? "" : ""))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    // Zapier often flattens lists to a newline- or comma-separated string.
    const separator = value.includes("\n") ? "\n" : ",";
    return value
      .split(separator)
      .map((s) => s.replace(/^[-*•]\s*/, "").trim())
      .filter(Boolean);
  }
  return [];
}

function asAttendees(value: unknown): Array<{ name?: string; email?: string }> {
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === "string") {
          const trimmed = v.trim();
          if (!trimmed) return null;
          return trimmed.includes("@") ? { email: trimmed } : { name: trimmed };
        }
        if (typeof v === "object" && v !== null) {
          const o = v as Record<string, unknown>;
          const name = asString(o.name ?? o.fullName ?? o.full_name) ?? undefined;
          const email = asString(o.email) ?? undefined;
          if (!name && !email) return null;
          return { name, email };
        }
        return null;
      })
      .filter((a): a is { name?: string; email?: string } => a !== null);
  }
  if (typeof value === "string") {
    return asStringList(value).map((s) =>
      s.includes("@") ? { email: s } : { name: s }
    );
  }
  return [];
}

export interface NormalizeResult {
  ok: boolean;
  payload?: CirclebackPayload;
  error?: string;
}

export function normalizeCirclebackPayload(raw: unknown): NormalizeResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Payload must be a JSON object." };
  }
  const r = raw as Record<string, unknown>;

  const meetingId = asString(
    firstValue(r, ["meetingId", "meeting_id", "meetingID", "id"])
  );
  const title = asString(firstValue(r, ["title", "meetingTitle", "meeting_title", "name"]));
  const meetingDate = asString(
    firstValue(r, ["meetingDate", "meeting_date", "date", "startTime", "start_time"])
  );
  const notes = asString(firstValue(r, ["notes", "meetingNotes", "meeting_notes", "summary"])) ?? "";
  const transcript = asString(firstValue(r, ["transcript", "meetingTranscript", "meeting_transcript"])) ?? "";
  const sourceUrl = asString(firstValue(r, ["sourceUrl", "source_url", "url", "meetingUrl", "meeting_url", "link"]));
  const attendees = asAttendees(firstValue(r, ["attendees", "participants", "attendee_names"]));
  const actionItems = asStringList(firstValue(r, ["actionItems", "action_items", "actions"]));

  if (!meetingId) return { ok: false, error: "Missing meeting ID (expected meetingId / meeting_id / id)." };
  if (!title) return { ok: false, error: "Missing meeting title." };
  if (!notes && !transcript && actionItems.length === 0) {
    return { ok: false, error: "Payload has no notes, transcript, or action items — nothing to process." };
  }

  const candidate = {
    meetingId,
    title,
    meetingDate: meetingDate ?? null,
    attendees,
    notes,
    transcript,
    actionItems,
    sourceUrl: sourceUrl ?? null,
  };

  const parsed = circlebackPayloadSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, payload: parsed.data };
}

export function parseMeetingDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}
