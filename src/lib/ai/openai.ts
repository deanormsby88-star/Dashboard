import { getEnv } from "@/lib/env";

/**
 * Thin client for the OpenAI Responses API with strict JSON-schema
 * structured output. Deliberately dependency-free: one endpoint, one shape.
 */

export interface StructuredCallParams {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
}

export interface StructuredCallResult {
  ok: boolean;
  rawText: string | null;
  usage: unknown | null;
  error: string | null;
}

export async function callStructured(params: StructuredCallParams): Promise<StructuredCallResult> {
  const env = getEnv();

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: params.model,
        input: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
        ],
        max_output_tokens: params.maxOutputTokens ?? 4096,
        text: {
          format: {
            type: "json_schema",
            name: params.schemaName,
            strict: true,
            schema: params.jsonSchema,
          },
        },
      }),
    });
  } catch (err) {
    return { ok: false, rawText: null, usage: null, error: `OpenAI request failed: ${errMessage(err)}` };
  }

  const bodyText = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      rawText: bodyText.slice(0, 4000),
      usage: null,
      error: `OpenAI API error ${response.status}`,
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, rawText: bodyText.slice(0, 4000), usage: null, error: "OpenAI returned non-JSON response body." };
  }

  const b = body as {
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
    usage?: unknown;
    error?: { message?: string };
  };

  if (b.error?.message) {
    return { ok: false, rawText: bodyText.slice(0, 4000), usage: b.usage ?? null, error: b.error.message };
  }

  for (const item of b.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return { ok: true, rawText: content.text, usage: b.usage ?? null, error: null };
      }
      if (content.type === "refusal") {
        return { ok: false, rawText: content.refusal ?? null, usage: b.usage ?? null, error: "Model refused the request." };
      }
    }
  }

  return { ok: false, rawText: bodyText.slice(0, 4000), usage: b.usage ?? null, error: "No output_text found in OpenAI response." };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
