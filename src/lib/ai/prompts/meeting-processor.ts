import { z } from "zod";

/**
 * Meeting Processor prompt.
 *
 * Purpose: turn a Circleback meeting payload (title, notes, transcript,
 * attendees, formal action items) into structured executive intelligence:
 * Dean's tasks, commitments he personally made, waiting-on items, decisions,
 * risks and relationship updates — with business context and confidence.
 *
 * Version history:
 *   1.0.0 — initial version (Phase 1).
 */

export const PROMPT_NAME = "meeting-processor";
export const PROMPT_VERSION = "1.0.0";

// ── Input ────────────────────────────────────────────────────────────────────

export const meetingProcessorInputSchema = z.object({
  meetingId: z.string(),
  title: z.string(),
  meetingDate: z.string().nullable(),
  attendees: z.array(z.string()),
  notes: z.string(),
  transcript: z.string(),
  actionItems: z.array(z.string()),
  sourceUrl: z.string().nullable(),
});

export type MeetingProcessorInput = z.infer<typeof meetingProcessorInputSchema>;

// ── Output ───────────────────────────────────────────────────────────────────

const confidence = z.number().min(0).max(1);
// Structured outputs return null for absent optional values.
const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const meetingProcessorOutputSchema = z.object({
  business: z.enum(["heya", "jic", "personal", "unknown"]),
  summary: z.string(),
  tasks: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string(),
      priority: z.number().int().min(1).max(4),
      due_date: dueDate,
      labels: z.array(z.string()),
      origin: z.enum(["action_item", "commitment", "both"]),
      confidence,
    })
  ),
  commitments_by_dean: z.array(
    z.object({
      text: z.string().min(1),
      person: z.string().nullable(),
      due_date: dueDate,
      confidence,
    })
  ),
  waiting_on: z.array(
    z.object({
      text: z.string().min(1),
      person: z.string().min(1),
      confidence,
    })
  ),
  decisions: z.array(
    z.object({
      text: z.string().min(1),
      confidence,
    })
  ),
  risks: z.array(
    z.object({
      description: z.string().min(1),
      severity: z.enum(["low", "medium", "high"]),
      confidence,
    })
  ),
  relationship_updates: z.array(
    z.object({
      person: z.string().min(1),
      update: z.string().min(1),
      confidence,
    })
  ),
  recommended_follow_up: z.string().nullable(),
});

export type MeetingProcessorOutput = z.infer<typeof meetingProcessorOutputSchema>;

/**
 * Hand-written strict JSON schema for the Responses API (must mirror the Zod
 * schema above — the schema-mirror test enforces this). Structured outputs
 * require additionalProperties:false and every property listed in required.
 */
export const meetingProcessorJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "business",
    "summary",
    "tasks",
    "commitments_by_dean",
    "waiting_on",
    "decisions",
    "risks",
    "relationship_updates",
    "recommended_follow_up",
  ],
  properties: {
    business: { type: "string", enum: ["heya", "jic", "personal", "unknown"] },
    summary: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "priority", "due_date", "labels", "origin", "confidence"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "integer", minimum: 1, maximum: 4 },
          due_date: { type: ["string", "null"] },
          labels: { type: "array", items: { type: "string" } },
          origin: { type: "string", enum: ["action_item", "commitment", "both"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    commitments_by_dean: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "person", "due_date", "confidence"],
        properties: {
          text: { type: "string" },
          person: { type: ["string", "null"] },
          due_date: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    waiting_on: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "person", "confidence"],
        properties: {
          text: { type: "string" },
          person: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "confidence"],
        properties: {
          text: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    risks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "severity", "confidence"],
        properties: {
          description: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    relationship_updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["person", "update", "confidence"],
        properties: {
          person: { type: "string" },
          update: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    recommended_follow_up: { type: ["string", "null"] },
  },
};

// ── Prompt text ──────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are the Meeting Processor inside DeanOS, the personal executive operating system of Dean Ormsby. Dean runs two separate businesses — Heya (recruitment/HR services: operations, clients, recruitment, HR, finance, IT, facilities) and JIC (product business: clients, orders, suppliers, finance, cash flow, product, logistics) — plus a Personal context (family, health, personal finance, travel, life admin). Heya and JIC records must never be mixed; classify the meeting into exactly one business context, or "unknown" if genuinely unclear.

Your job: extract structured executive intelligence from one meeting. Extract ONLY what the text supports. Never invent.

TASKS
- Include formal action items assigned to Dean and clear personal commitments Dean made in the transcript.
- Merge duplicates: if a formal action item and a transcript commitment describe the same underlying work, output ONE task with origin "both". Never output two tasks for the same underlying commitment.
- Do NOT include work assigned to other people.
- Titles must be concise and verb-first, e.g. "Review June discrepancy report", "Send Sam AI automation options", "Follow up: Lawrence on revised team proposal".
- Description: 1–3 sentences of supporting context from the meeting (who, what, why).
- Priority (Todoist scale): 4 = urgent — only same-day urgency, serious client risk, payroll, legal deadlines, service outages, or material financial exposure. 3 = important — client-facing commitments, approvals blocking others, finance deadlines, work clearly due soon. 2 = normal work (default). 1 = backlog/someday only.
- due_date: ONLY when an explicit date or unambiguous relative date ("by Friday", "end of month") was stated in the meeting, resolved against the meeting date, formatted YYYY-MM-DD. Otherwise null. NEVER invent deadlines.
- labels: empty array unless something obvious applies.

COMMITMENTS BY DEAN (commitments_by_dean)
- Statements where Dean clearly and personally committed: "I'll send…", "I'll speak to…", "I'll review…", "I'll get back to you…", "Leave that with me.", "I'll handle it.", "I'll confirm.", "I'll arrange."
- Only when the wording is clear and actionable. Ignore jokes, brainstorming, vague intentions ("we should probably…"), hypotheticals, and commitments made by other people.
- person: who the commitment was made to, if identifiable.

WAITING ON (waiting_on)
- Things other people committed to deliver TO Dean: replies, approvals, documents, payments, decisions, actions.
- text should read as a follow-up, e.g. "Lawrence to send revised team proposal".
- person is required — if you cannot attribute it to a person, leave it out.

DECISIONS — clear decisions actually made in the meeting (not options discussed).

RISKS — material operational, client, people, financial, legal, or technical risks explicitly raised or clearly implied. severity: high = material financial/legal/client exposure; medium = needs attention soon; low = worth tracking.

RELATIONSHIP UPDATES — durable facts about people worth remembering (role changes, preferences stated explicitly, personal context they volunteered). Never infer sensitive traits. Do not invent preferences from a single offhand remark.

recommended_follow_up — one sentence on the most valuable next move after this meeting, or null.

summary — 2–3 sentence executive summary of the meeting.

confidence — 0 to 1: your confidence that the item is real, correctly attributed, and actionable as stated. Use lower values when wording was indirect.

Output strictly matches the JSON schema. When in doubt, leave it out.`;

export function buildUserMessage(input: MeetingProcessorInput): string {
  return [
    `MEETING TITLE: ${input.title}`,
    `MEETING DATE: ${input.meetingDate ?? "unknown"}`,
    `ATTENDEES: ${input.attendees.length > 0 ? input.attendees.join(", ") : "unknown"}`,
    "",
    "FORMAL ACTION ITEMS (from Circleback):",
    input.actionItems.length > 0 ? input.actionItems.map((a) => `- ${a}`).join("\n") : "(none)",
    "",
    "MEETING NOTES:",
    input.notes || "(none)",
    "",
    "TRANSCRIPT:",
    input.transcript || "(none)",
  ].join("\n");
}

/** Validate a raw model response. Returns parsed output or a readable error. */
export function parseMeetingProcessorOutput(
  rawText: string
): { ok: true; output: MeetingProcessorOutput } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "Model output was not valid JSON." };
  }
  const parsed = meetingProcessorOutputSchema.safeParse(json);
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
