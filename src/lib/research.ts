import { getEnv } from "@/lib/env";
import { callStructured, callWebSearch } from "@/lib/ai/openai";
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

// ── Recommendations with deep links ────────────────────────────────────────

const RECS_SEARCH_SYSTEM =
  "You are DeanOS's recommendations researcher. Use web search to find real, currently-operating options for the user's request — services, providers, restaurants, products, places. For EACH option capture: exact name, a one-line reason it's a good pick, official website URL, phone number, and street address or area. When the request is local, prioritise Johannesburg / Randburg, South Africa (Dean is in Pierneef Park). Return 4–6 solid options using only real details from the search results — never invent names, numbers, or URLs.";

const RECS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["options"],
  properties: {
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "why", "website", "phone", "address", "booking_url"],
        properties: {
          name: { type: "string" },
          why: { type: "string" },
          website: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          address: { type: ["string", "null"] },
          booking_url: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

function mapsLink(name: string, address: string | null): string {
  const q = encodeURIComponent([name, address].filter(Boolean).join(" "));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

interface Recommendation {
  name: string;
  why: string;
  website: string | null;
  phone: string | null;
  address: string | null;
  booking_url: string | null;
}

/**
 * Research a request and return a tidy, tappable set of options: each with why,
 * website, phone (tap-to-call on mobile), directions (Google Maps), and a
 * booking link where one exists. Public web only.
 */
export async function findRecommendations(query: string): Promise<{ ok: boolean; text: string }> {
  const owner = await ensureOwner().catch(() => null);
  const model = getEnv().OPENAI_MODEL_PRIORITIZER;

  const search = await callWebSearch({ model, system: RECS_SEARCH_SYSTEM, user: query, maxOutputTokens: 1600 });
  if (!search.ok || !search.rawText) {
    return { ok: false, text: `Couldn't research that right now${search.error ? ` (${search.error})` : ""}.` };
  }

  const structured = await callStructured({
    model,
    system: "Extract the options as structured data. Use ONLY details present in the text; set any field you can't find to null. Do not invent phone numbers or URLs.",
    user: search.rawText,
    schemaName: "recommendations",
    jsonSchema: RECS_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 1600,
  });

  let options: Recommendation[] = [];
  if (structured.ok && structured.rawText) {
    try {
      options = (JSON.parse(structured.rawText) as { options?: Recommendation[] }).options ?? [];
    } catch {
      options = [];
    }
  }

  if (owner) {
    await insertAiRun({
      userId: owner.user.id,
      promptName: "research:recommendations",
      promptVersion: "1.0.0",
      model,
      input: { query },
      rawOutput: search.rawText,
      parsedOutput: { count: options.length },
      status: "ok",
      error: null,
      usage: search.usage,
    }).catch(() => {});
  }

  if (options.length === 0) return { ok: true, text: search.rawText }; // fall back to prose

  const blocks = options.map((o, i) => {
    const lines = [`${i + 1}. ${o.name} — ${o.why}`];
    if (o.website) lines.push(`   🌐 ${o.website}`);
    if (o.phone) lines.push(`   📞 ${o.phone}`);
    if (o.address) lines.push(`   🧭 ${mapsLink(o.name, o.address)}`);
    if (o.booking_url) lines.push(`   📅 Book: ${o.booking_url}`);
    return lines.join("\n");
  });
  return { ok: true, text: blocks.join("\n\n") };
}

/** Build a public-only query for a person from their public identifiers. */
export function personResearchQuery(name: string, role?: string | null, organization?: string | null): string {
  const bits = [name, role, organization].filter(Boolean).join(", ");
  return `Give a short professional briefing on this person for a meeting: ${bits}. Cover their current role, the company/organisation, and any recent relevant public news or developments. Public information only.`;
}
