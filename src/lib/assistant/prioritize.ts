import { getEnv } from "@/lib/env";
import { callStructured } from "@/lib/ai/openai";
import * as prioritizer from "@/lib/ai/prompts/executive-prioritizer";
import type { StateSnapshot } from "@/lib/assistant/state";
import { ensureOwner, insertAiRun } from "@/lib/db/repo";

/**
 * Runs the Executive Prioritizer over a state snapshot, logging the call to
 * ai_runs. Shared by the Assistant commands, the Today dashboard, and the
 * scheduled daily-brief job so they all reason identically.
 */
export async function runPrioritizer(
  snapshot: StateSnapshot
): Promise<{ ok: true; output: prioritizer.PrioritizerOutput } | { ok: false; error: string }> {
  const owner = await ensureOwner();
  const model = getEnv().OPENAI_MODEL_PRIORITIZER;
  const result = await callStructured({
    model,
    system: prioritizer.SYSTEM_PROMPT,
    user: prioritizer.buildUserMessage(JSON.stringify(snapshot)),
    schemaName: "prioritization",
    jsonSchema: prioritizer.prioritizerJsonSchema,
    maxOutputTokens: 2048,
  });
  const parsed =
    result.ok && result.rawText !== null ? prioritizer.parsePrioritizerOutput(result.rawText) : null;
  await insertAiRun({
    userId: owner.user.id,
    promptName: prioritizer.PROMPT_NAME,
    promptVersion: prioritizer.PROMPT_VERSION,
    model,
    input: snapshot,
    rawOutput: result.rawText,
    parsedOutput: parsed?.ok ? parsed.output : null,
    status: !result.ok ? "api_failed" : parsed?.ok ? "ok" : "parse_failed",
    error: !result.ok ? result.error : parsed?.ok ? null : (parsed?.error ?? "unknown"),
    usage: result.usage,
  });
  if (!result.ok || !parsed) return { ok: false, error: result.error ?? "Prioritizer call failed." };
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, output: parsed.output };
}

export function formatTop3(output: prioritizer.PrioritizerOutput): string {
  return output.top_three.map((t, i) => `${i + 1}. ${t.title}\n   ${t.why}`).join("\n");
}
