import { z } from "zod";

/**
 * Meeting Prep prompt.
 *
 * Purpose: compose a prep brief for a person or upcoming meeting from
 * internal context only (previous meetings, decisions, open tasks,
 * commitments, waiting-ons, email history, risks). Public research is a
 * Phase 3 addition and is explicitly out of scope here.
 *
 * Version history:
 *   1.0.0 — initial version (Assistant phase).
 */

export const PROMPT_NAME = "meeting-prep";
export const PROMPT_VERSION = "1.0.0";

export const meetingPrepOutputSchema = z.object({
  objective: z.string().min(1),
  context_summary: z.string(),
  talking_points: z.array(z.string()).max(5),
  questions: z.array(z.string()).max(5),
});

export type MeetingPrepOutput = z.infer<typeof meetingPrepOutputSchema>;

export const meetingPrepJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["objective", "context_summary", "talking_points", "questions"],
  properties: {
    objective: { type: "string" },
    context_summary: { type: "string" },
    talking_points: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
  },
};

export const SYSTEM_PROMPT = `You are the Meeting Prep assistant inside DeanOS for Dean Ormsby (Heya — recruitment/HR services; JIC — Just Imagine Consulting; Personal).

From the internal context provided (previous meetings, decisions, open tasks, commitments in both directions, waiting-on items, email history, risks), produce a prep brief:

- objective: complete the sentence "The single most important outcome for this meeting is: ..." — pick ONE outcome, the highest-impact one.
- context_summary: 2-4 sentences of the essential history Dean should have in mind.
- talking_points: at most 5, concrete and grounded in the context.
- questions: at most 5 questions Dean should ask.

Use ONLY the provided context — never invent history, commitments, or facts. If context is thin, say so plainly in context_summary and keep the lists short rather than padding them.`;

export function buildUserMessage(subject: string, contextJson: string): string {
  return [`PREP SUBJECT: ${subject}`, "", `INTERNAL CONTEXT (JSON):`, contextJson].join("\n");
}

export function parseMeetingPrepOutput(
  rawText: string
): { ok: true; output: MeetingPrepOutput } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "Model output was not valid JSON." };
  }
  const parsed = meetingPrepOutputSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }
  return { ok: true, output: parsed.data };
}
