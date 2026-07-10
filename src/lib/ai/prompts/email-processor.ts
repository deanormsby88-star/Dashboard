import { z } from "zod";

/**
 * Email Processor prompt.
 *
 * Purpose: classify one email event (Ignore / Action / Waiting On / Risk /
 * Reference / Relationship Update), optionally suggest a task or waiting-on
 * record, and detect substantive replies that resolve existing waiting-on
 * items.
 *
 * Version history:
 *   1.0.0 — initial version (Phase 2).
 */

export const PROMPT_NAME = "email-processor";
export const PROMPT_VERSION = "1.0.0";

// ── Input ────────────────────────────────────────────────────────────────────

export const emailProcessorInputSchema = z.object({
  mailbox: z.enum(["heya", "jic", "personal"]),
  direction: z.enum(["inbound", "outbound"]),
  sender: z.string(),
  recipients: z.array(z.string()),
  subject: z.string(),
  body: z.string(),
  emailDate: z.string().nullable(),
  flags: z.array(z.string()),
  openWaitingOn: z.array(
    z.object({ id: z.string(), text: z.string(), person: z.string().nullable() })
  ),
});

export type EmailProcessorInput = z.infer<typeof emailProcessorInputSchema>;

// ── Output ───────────────────────────────────────────────────────────────────

const confidence = z.number().min(0).max(1);
const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const emailProcessorOutputSchema = z.object({
  classification: z.enum(["ignore", "action", "waiting_on", "risk", "reference", "relationship_update"]),
  confidence,
  summary: z.string(),
  suggested_task: z
    .object({
      title: z.string().min(1),
      description: z.string(),
      priority: z.number().int().min(1).max(4),
      due_date: dueDate,
    })
    .nullable(),
  waiting_on: z
    .object({
      text: z.string().min(1),
      person: z.string().min(1),
    })
    .nullable(),
  risk: z
    .object({
      description: z.string().min(1),
      severity: z.enum(["low", "medium", "high"]),
    })
    .nullable(),
  relationship_update: z
    .object({
      person: z.string().min(1),
      update: z.string().min(1),
    })
    .nullable(),
  resolves_waiting_on_ids: z.array(z.string()),
});

export type EmailProcessorOutput = z.infer<typeof emailProcessorOutputSchema>;

/** Strict JSON schema mirror for the Responses API (see schema-mirror test). */
export const emailProcessorJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "classification",
    "confidence",
    "summary",
    "suggested_task",
    "waiting_on",
    "risk",
    "relationship_update",
    "resolves_waiting_on_ids",
  ],
  properties: {
    classification: {
      type: "string",
      enum: ["ignore", "action", "waiting_on", "risk", "reference", "relationship_update"],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    summary: { type: "string" },
    suggested_task: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["title", "description", "priority", "due_date"],
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "integer", minimum: 1, maximum: 4 },
        due_date: { type: ["string", "null"] },
      },
    },
    waiting_on: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["text", "person"],
      properties: {
        text: { type: "string" },
        person: { type: "string" },
      },
    },
    risk: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["description", "severity"],
      properties: {
        description: { type: "string" },
        severity: { type: "string", enum: ["low", "medium", "high"] },
      },
    },
    relationship_update: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["person", "update"],
      properties: {
        person: { type: "string" },
        update: { type: "string" },
      },
    },
    resolves_waiting_on_ids: { type: "array", items: { type: "string" } },
  },
};

// ── Prompt text ──────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are the Email Processor inside DeanOS, the personal executive operating system of Dean Ormsby. Dean runs Heya (recruitment/HR services) and JIC / Just Imagine Consulting (consulting business), plus a Personal context. The mailbox context is given and fixed — do not reclassify the business.

Your job: classify ONE email event and extract only what the text supports. Never invent.

CLASSIFICATION (choose exactly one)
- "action": Dean must reply, decide, review, approve, send, schedule, call, pay, or prepare something. Provide suggested_task.
- "waiting_on": Dean has already acted (usually an OUTBOUND email where Dean asks for something, or a thread where his request is pending) and now awaits a reply, approval, payment, document, confirmation, decision, or completion from someone else. Provide waiting_on.
- "risk": the email surfaces a material operational, client, people, financial, legal, or technical risk. Provide risk. (If it also needs action, prefer "action" and mention the risk in the description.)
- "relationship_update": no action needed, but the email contains a durable fact about a person worth remembering (role change, new contact, explicitly stated preference). Provide relationship_update.
- "reference": legitimately useful information, no action required (reports, confirmations of things already done, FYIs from colleagues).
- "ignore": newsletters, marketing, automated notifications, receipts for routine subscriptions, spam, out-of-office replies, calendar boilerplate.

HARD RULES
- Never create a task for newsletters, marketing, or routine automated notifications — classify them "ignore" even if they contain imperative language.
- An email being unread or flagged is NOT by itself a reason for a task; judge the content.
- NEVER invent deadlines: due_date only when the email states an explicit date or unambiguous relative date (resolve it against the email date, format YYYY-MM-DD).
- Task titles concise and verb-first, e.g. "Reply to Sam about AI tool options", "Approve supplier invoice", "Pay Anchor Offices deposit".
- Priorities (Todoist scale): 4 only for same-day urgency, serious client risk, payroll, legal deadlines, outages, or material financial exposure; 3 for client-facing commitments, approvals blocking others, finance deadlines, or work clearly due soon; 2 normal (default); 1 backlog.
- waiting_on.text should read as a follow-up, e.g. "Lawrence to send signed contract".

RESOLVING WAITING-ON ITEMS
You are given Dean's currently open waiting-on items with IDs. If this INBOUND email substantively delivers what an item was waiting for (the document arrives, the approval is given, the question is answered, payment confirmed), include that item's id in resolves_waiting_on_ids. A mere acknowledgment ("got it, will look next week") does NOT resolve. Only use IDs from the provided list. When unsure, do not resolve.

summary — one or two sentences: what this email is and what (if anything) Dean should do.
confidence — 0 to 1 for the classification itself.

Set unused optional objects to null. Output strictly matches the JSON schema. When in doubt, prefer "reference" or "ignore" over creating work.`;

export function buildUserMessage(input: EmailProcessorInput): string {
  const waiting =
    input.openWaitingOn.length > 0
      ? input.openWaitingOn
          .map((w) => `- id: ${w.id} | ${w.text}${w.person ? ` (from ${w.person})` : ""}`)
          .join("\n")
      : "(none)";
  return [
    `MAILBOX (business context): ${input.mailbox}`,
    `DIRECTION: ${input.direction}`,
    `FROM: ${input.sender}`,
    `TO: ${input.recipients.join(", ") || "unknown"}`,
    `DATE: ${input.emailDate ?? "unknown"}`,
    `FLAGS/CATEGORIES: ${input.flags.join(", ") || "(none)"}`,
    `SUBJECT: ${input.subject || "(no subject)"}`,
    "",
    "DEAN'S OPEN WAITING-ON ITEMS:",
    waiting,
    "",
    "EMAIL BODY:",
    input.body || "(empty)",
  ].join("\n");
}

export function parseEmailProcessorOutput(
  rawText: string
): { ok: true; output: EmailProcessorOutput } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "Model output was not valid JSON." };
  }
  const parsed = emailProcessorOutputSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Model output failed schema validation: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    };
  }
  return { ok: true, output: parsed.data };
}
