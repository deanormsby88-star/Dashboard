import { z } from "zod";

/**
 * Quick Capture prompt.
 *
 * Purpose: turn one line of natural language from Dean into the right
 * DeanOS record: a task, a waiting-on item, a risk, a relationship note,
 * or a plain note. Used by the Assistant's `capture` and `remember`
 * commands.
 *
 * Version history:
 *   1.0.0 — initial version (Assistant phase).
 */

export const PROMPT_NAME = "quick-capture";
export const PROMPT_VERSION = "1.0.0";

const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const quickCaptureOutputSchema = z.object({
  kind: z.enum(["task", "waiting_on", "risk", "relationship_update", "note"]),
  business: z.enum(["heya", "jic", "personal", "unknown"]),
  task: z
    .object({
      title: z.string().min(1),
      description: z.string(),
      priority: z.number().int().min(1).max(4),
      due_date: dueDate,
    })
    .nullable(),
  waiting_on: z.object({ text: z.string().min(1), person: z.string().min(1) }).nullable(),
  risk: z
    .object({ description: z.string().min(1), severity: z.enum(["low", "medium", "high"]) })
    .nullable(),
  relationship_update: z.object({ person: z.string().min(1), update: z.string().min(1) }).nullable(),
  note: z.string().nullable(),
});

export type QuickCaptureOutput = z.infer<typeof quickCaptureOutputSchema>;

export const quickCaptureJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "business", "task", "waiting_on", "risk", "relationship_update", "note"],
  properties: {
    kind: { type: "string", enum: ["task", "waiting_on", "risk", "relationship_update", "note"] },
    business: { type: "string", enum: ["heya", "jic", "personal", "unknown"] },
    task: {
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
    note: { type: ["string", "null"] },
  },
};

export const SYSTEM_PROMPT = `You are the Quick Capture parser inside DeanOS for Dean Ormsby (businesses: Heya = recruitment/HR services; JIC = Just Imagine Consulting; plus Personal).

Turn Dean's one-liner into exactly one record:
- "task": something Dean must do. Title concise and verb-first. Priority: 4 only for same-day urgency/serious risk; 3 for client-facing or blocking work; 2 normal (default); 1 backlog. due_date ONLY if Dean stated an explicit date or unambiguous relative date (resolve against today's date given in the message) — never invent one.
- "waiting_on": someone owes Dean something ("waiting on X for Y", "X said he'd send…"). text reads like "X to send Y".
- "risk": a concern or exposure worth tracking, not an action.
- "relationship_update": a durable fact about a person ("remember that Sam prefers calls over email").
- "note": anything else worth keeping.

business: infer from content (Heya = recruitment/HR/team/clients-of-heya; JIC = consulting/orders/suppliers; Personal = family/health/home/finance-personal). Use "unknown" when unclear.

Fill exactly one of task / waiting_on / risk / relationship_update / note (matching kind); set the others null.`;

export function buildUserMessage(text: string, todayIso: string, hint?: "remember"): string {
  return [
    `TODAY: ${todayIso}`,
    hint === "remember"
      ? "MODE: remember — Dean wants this kept as a relationship update or note, not turned into work."
      : "MODE: capture",
    "",
    `DEAN SAYS: ${text}`,
  ].join("\n");
}

export function parseQuickCaptureOutput(
  rawText: string
): { ok: true; output: QuickCaptureOutput } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "Model output was not valid JSON." };
  }
  const parsed = quickCaptureOutputSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }
  return { ok: true, output: parsed.data };
}
