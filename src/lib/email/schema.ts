import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Email payload model for POST /api/webhooks/zapier/email.
 * Accepts naming variants from Zapier's Outlook and Gmail integrations and
 * infers what it can (direction from Dean's own addresses, message ID from a
 * content hash when the integration doesn't expose one).
 */

// Dean's mailboxes → business context. Single-user app; used only as a
// fallback when the Zap doesn't set an explicit mailbox field.
export const MAILBOX_ADDRESSES: Record<string, "heya" | "jic" | "personal"> = {
  "deano@heya.team": "heya",
  "dean@justimagineconsulting.co.za": "jic",
  "dean.ormsby88@gmail.com": "personal",
};

const OWN_ADDRESSES = new Set(Object.keys(MAILBOX_ADDRESSES));

export const emailPayloadSchema = z.object({
  mailbox: z.enum(["heya", "jic", "personal"]),
  direction: z.enum(["inbound", "outbound"]),
  sender: z.string(),
  recipients: z.array(z.string()),
  subject: z.string(),
  bodyText: z.string(),
  emailDate: z.string().nullable(),
  threadId: z.string().nullable(),
  messageId: z.string().min(1),
  sourceUrl: z.string().nullable(),
  flags: z.array(z.string()),
  attachments: z.unknown().nullable(),
});

export type EmailPayload = z.infer<typeof emailPayloadSchema>;

const MAX_STORED_BODY = 20_000;

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

function asAddressList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        typeof v === "string"
          ? v
          : typeof v === "object" && v !== null
            ? (asString((v as Record<string, unknown>).email ?? (v as Record<string, unknown>).address) ?? "")
            : ""
      )
      .map(normalizeAddress)
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\n]/)
      .map(normalizeAddress)
      .filter(Boolean);
  }
  return [];
}

/** Extract a bare lowercase address from forms like `Dean Ormsby <deano@heya.team>`. */
export function normalizeAddress(input: string): string {
  const match = input.match(/<([^>]+)>/);
  const addr = (match ? match[1] : input).trim().toLowerCase();
  return addr.includes("@") ? addr : addr;
}

/** Strip HTML if the Zap sent an HTML body; cheap but effective for AI input. */
export function stripHtml(input: string): string {
  if (!/<[a-z][\s\S]*>/i.test(input)) return input;
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export interface EmailNormalizeResult {
  ok: boolean;
  payload?: EmailPayload;
  error?: string;
}

export function normalizeEmailPayload(raw: unknown): EmailNormalizeResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Payload must be a JSON object." };
  }
  const r = raw as Record<string, unknown>;

  const sender = normalizeAddress(
    asString(firstValue(r, ["sender", "from", "from_email", "fromEmail", "from_address"])) ?? ""
  );
  const recipients = asAddressList(
    firstValue(r, ["recipients", "to", "to_email", "toEmail", "to_recipients", "toRecipients", "cc"])
  );
  const subject = asString(firstValue(r, ["subject", "email_subject"])) ?? "";
  const bodyRaw =
    asString(
      firstValue(r, ["bodyText", "body_text", "body", "body_plain", "bodyPlain", "body_preview", "bodyPreview", "snippet"])
    ) ?? "";
  const bodyText = stripHtml(bodyRaw).slice(0, MAX_STORED_BODY);

  // Mailbox: explicit field wins; else infer from which of Dean's addresses appears.
  let mailbox = (asString(firstValue(r, ["mailbox", "mailbox_context", "mailboxContext", "context"])) ?? "")
    .trim()
    .toLowerCase();
  if (!["heya", "jic", "personal"].includes(mailbox)) {
    const own =
      (OWN_ADDRESSES.has(sender) ? sender : undefined) ??
      recipients.find((a) => OWN_ADDRESSES.has(a));
    mailbox = own ? MAILBOX_ADDRESSES[own] : "";
  }
  if (!mailbox) {
    return {
      ok: false,
      error:
        "Missing mailbox context (expected mailbox = heya | jic | personal, or a recognizable Dean address).",
    };
  }

  // Direction: explicit field wins; else outbound iff Dean is the sender.
  let direction = (asString(firstValue(r, ["direction"])) ?? "").trim().toLowerCase();
  if (direction !== "inbound" && direction !== "outbound") {
    direction = OWN_ADDRESSES.has(sender) ? "outbound" : "inbound";
  }

  const emailDate = asString(
    firstValue(r, ["emailDate", "date", "received_at", "receivedAt", "received_date", "sent_at", "createdDateTime"])
  );
  const threadId = asString(
    firstValue(r, ["threadId", "thread_id", "conversationId", "conversation_id"])
  );
  let messageId = asString(firstValue(r, ["messageId", "message_id", "id", "internet_message_id", "internetMessageId"]));
  const sourceUrl = asString(firstValue(r, ["sourceUrl", "source_url", "url", "webLink", "web_link", "link"]));
  const flagsRaw = firstValue(r, ["flags", "categories", "labels"]);
  const flags = asAddressList(flagsRaw).length > 0 && typeof flagsRaw !== "string"
    ? (flagsRaw as unknown[]).map((f) => String(f))
    : typeof flagsRaw === "string"
      ? flagsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  const attachments = firstValue(r, ["attachments", "attachment_metadata", "attachmentMetadata"]) ?? null;

  if (!subject && !bodyText) {
    return { ok: false, error: "Email has no subject and no body — nothing to process." };
  }

  if (!messageId) {
    const basis = [sender, subject, emailDate ?? "", bodyText.slice(0, 300)].join("|");
    messageId = `derived-${createHash("sha256").update(basis).digest("hex").slice(0, 24)}`;
  }

  const candidate: EmailPayload = {
    mailbox: mailbox as EmailPayload["mailbox"],
    direction: direction as EmailPayload["direction"],
    sender,
    recipients,
    subject,
    bodyText,
    emailDate: emailDate ?? null,
    threadId: threadId ?? null,
    messageId,
    sourceUrl: sourceUrl ?? null,
    flags,
    attachments,
  };

  const parsed = emailPayloadSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }
  return { ok: true, payload: parsed.data };
}

export function parseEmailDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}
