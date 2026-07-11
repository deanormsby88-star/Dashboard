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

// ── Tool-calling (agent) support ─────────────────────────────────────────────

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type AgentInputItem =
  | { role: "system" | "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

export interface AgentResponse {
  ok: boolean;
  error: string | null;
  usage: unknown | null;
  text: string | null;
  toolCalls: Array<{ callId: string; name: string; arguments: string }>;
}

/**
 * One turn of the Responses API with tools. Returns either tool calls to
 * execute (caller feeds results back and calls again) or final text.
 */
export async function callResponses(params: {
  model: string;
  input: AgentInputItem[];
  tools: AgentTool[];
  maxOutputTokens?: number;
}): Promise<AgentResponse> {
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
        input: params.input,
        tools: params.tools.map((t) => ({
          type: "function",
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        max_output_tokens: params.maxOutputTokens ?? 2048,
      }),
    });
  } catch (err) {
    return { ok: false, error: `OpenAI request failed: ${errMessage(err)}`, usage: null, text: null, toolCalls: [] };
  }

  const bodyText = await response.text();
  if (!response.ok) {
    return { ok: false, error: `OpenAI API error ${response.status}`, usage: null, text: bodyText.slice(0, 2000), toolCalls: [] };
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, error: "OpenAI returned non-JSON body.", usage: null, text: null, toolCalls: [] };
  }
  const b = body as {
    output?: Array<{
      type?: string;
      call_id?: string;
      name?: string;
      arguments?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
    usage?: unknown;
    error?: { message?: string };
  };
  if (b.error?.message) {
    return { ok: false, error: b.error.message, usage: b.usage ?? null, text: null, toolCalls: [] };
  }

  const toolCalls: AgentResponse["toolCalls"] = [];
  let text: string | null = null;
  for (const item of b.output ?? []) {
    if (item.type === "function_call" && item.call_id && item.name) {
      toolCalls.push({ callId: item.call_id, name: item.name, arguments: item.arguments ?? "{}" });
    } else if (item.type === "message") {
      for (const content of item.content ?? []) {
        if (content.type === "output_text" && typeof content.text === "string") {
          text = (text ?? "") + content.text;
        }
      }
    }
  }
  return { ok: true, error: null, usage: b.usage ?? null, text, toolCalls };
}

export interface TextCallParams {
  model: string;
  system: string;
  user: string;
  maxOutputTokens?: number;
}

/** Free-form text composition (briefs, reviews, general chat) — no schema. */
export async function callText(params: TextCallParams): Promise<StructuredCallResult> {
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
        max_output_tokens: params.maxOutputTokens ?? 2048,
      }),
    });
  } catch (err) {
    return { ok: false, rawText: null, usage: null, error: `OpenAI request failed: ${errMessage(err)}` };
  }

  const bodyText = await response.text();
  if (!response.ok) {
    return { ok: false, rawText: bodyText.slice(0, 4000), usage: null, error: `OpenAI API error ${response.status}` };
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, rawText: bodyText.slice(0, 4000), usage: null, error: "OpenAI returned non-JSON response body." };
  }
  const b = body as {
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
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
    }
  }
  return { ok: false, rawText: bodyText.slice(0, 4000), usage: b.usage ?? null, error: "No output_text found in OpenAI response." };
}

/**
 * Free-form composition with the built-in web_search tool. Runs entirely on
 * the OpenAI account (no separate search key). Returns the model's answer
 * after it has searched; the query and any context passed here leave to
 * OpenAI's search — callers must pass only public identifiers, never
 * internal/confidential content.
 */
export async function callWebSearch(params: TextCallParams): Promise<StructuredCallResult> {
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
        tools: [{ type: "web_search" }],
        input: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
        ],
        max_output_tokens: params.maxOutputTokens ?? 1200,
      }),
    });
  } catch (err) {
    return { ok: false, rawText: null, usage: null, error: `OpenAI request failed: ${errMessage(err)}` };
  }
  const bodyText = await response.text();
  if (!response.ok) {
    return { ok: false, rawText: bodyText.slice(0, 2000), usage: null, error: `OpenAI API error ${response.status}` };
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, rawText: null, usage: null, error: "OpenAI returned non-JSON body." };
  }
  const b = body as {
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    usage?: unknown;
    error?: { message?: string };
  };
  if (b.error?.message) return { ok: false, rawText: null, usage: b.usage ?? null, error: b.error.message };
  let text = "";
  for (const item of b.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") text += content.text;
    }
  }
  return { ok: text.length > 0, rawText: text || null, usage: b.usage ?? null, error: text ? null : "No text in web-search response." };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
