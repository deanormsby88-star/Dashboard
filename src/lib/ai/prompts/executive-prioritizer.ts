import { z } from "zod";

/**
 * Executive Prioritizer prompt.
 *
 * Purpose: given a snapshot of everything DeanOS knows (open tasks,
 * suggestions, waiting-ons with aging, risks, recent meetings), recommend
 * the day's three highest-impact outcomes plus what to ignore, what's
 * becoming risky, and who to chase — per brief §13. Never ranks by due
 * date alone.
 *
 * Version history:
 *   1.0.0 — initial version (Assistant phase).
 */

export const PROMPT_NAME = "executive-prioritizer";
export const PROMPT_VERSION = "1.0.0";

export const prioritizerOutputSchema = z.object({
  top_three: z
    .array(
      z.object({
        title: z.string().min(1),
        why: z.string().min(1),
      })
    )
    .max(3),
  ignore_today: z.array(z.string()),
  becoming_risks: z.array(z.string()),
  waiting_on_dean: z.array(z.string()),
  chase: z.array(z.string()),
  recommendation: z.string(),
});

export type PrioritizerOutput = z.infer<typeof prioritizerOutputSchema>;

export const prioritizerJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["top_three", "ignore_today", "becoming_risks", "waiting_on_dean", "chase", "recommendation"],
  properties: {
    top_three: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "why"],
        properties: {
          title: { type: "string" },
          why: { type: "string" },
        },
      },
    },
    ignore_today: { type: "array", items: { type: "string" } },
    becoming_risks: { type: "array", items: { type: "string" } },
    waiting_on_dean: { type: "array", items: { type: "string" } },
    chase: { type: "array", items: { type: "string" } },
    recommendation: { type: "string" },
  },
};

export const SYSTEM_PROMPT = `You are the Executive Prioritizer inside DeanOS, the personal operating system of Dean Ormsby, who runs Heya (recruitment/HR services) and JIC / Just Imagine Consulting, alongside a Personal context.

From the state snapshot provided, recommend the day's highest-impact outcomes. Rules:

- top_three: EXACTLY the three highest-impact outcomes for today (fewer only if there genuinely isn't enough open work). Each with a one-sentence "why". Never rank purely by due date. Priority order for judging impact:
  1. safety or legal risk
  2. financial impact
  3. client impact
  4. team impact
  5. strategic importance
  6. time sensitivity
- ignore_today: open items that can safely wait — be specific.
- becoming_risks: items that are quietly turning into problems (aging waiting-ons, stale approvals, unmitigated risks).
- waiting_on_dean: people expecting something FROM Dean (from his open commitments).
- chase: people Dean should chase today (aging waiting-on items; 3+ business days without response deserves escalation).
- recommendation: one or two sentences of direct, practical advice for the day.

Base everything strictly on the snapshot. Never invent tasks, people, or deadlines. Be concrete and terse — this is for a busy executive.`;

export function buildUserMessage(snapshotJson: string): string {
  return `STATE SNAPSHOT (JSON):\n${snapshotJson}`;
}

export function parsePrioritizerOutput(
  rawText: string
): { ok: true; output: PrioritizerOutput } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "Model output was not valid JSON." };
  }
  const parsed = prioritizerOutputSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }
  return { ok: true, output: parsed.data };
}
