import { getEnv } from "@/lib/env";
import { callWebSearch } from "@/lib/ai/openai";
import { ensureOwner, insertAiRun } from "@/lib/db/repo";

const RESEARCH_SYSTEM =
  "You are DeanOS's public-research assistant. Use web search to answer with current, publicly available information only. Be concise and factual: lead with what matters, group into a few short points, and note the source or date where useful. If you can't find solid public information, say so plainly rather than guessing. This is PUBLIC research — never present it as internal knowledge.";

/**
 * Public web research via OpenAI's built-in search. Only ever receives
 * public identifiers (names, companies, topics) — never internal DeanOS
 * context — so nothing confidential leaves in the query.
 */
export async function research(query: string, label = "research"): Promise<{ ok: boolean; text: string }> {
  const owner = await ensureOwner().catch(() => null);
  const model = getEnv().OPENAI_MODEL_PRIORITIZER;
  const res = await callWebSearch({ model, system: RESEARCH_SYSTEM, user: query, maxOutputTokens: 1200 });
  if (owner) {
    await insertAiRun({
      userId: owner.user.id,
      promptName: `research:${label}`,
      promptVersion: "1.0.0",
      model,
      input: { query },
      rawOutput: res.rawText,
      parsedOutput: null,
      status: res.ok ? "ok" : "api_failed",
      error: res.error,
      usage: res.usage,
    }).catch(() => {});
  }
  return { ok: res.ok, text: res.rawText ?? `Couldn't complete the research: ${res.error}` };
}

/** Build a public-only query for a person from their public identifiers. */
export function personResearchQuery(name: string, role?: string | null, organization?: string | null): string {
  const bits = [name, role, organization].filter(Boolean).join(", ");
  return `Give a short professional briefing on this person for a meeting: ${bits}. Cover their current role, the company/organisation, and any recent relevant public news or developments. Public information only.`;
}
