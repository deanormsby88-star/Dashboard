import { getEnv } from "@/lib/env";
import type { Business, Task } from "@/lib/types";

/**
 * Todoist execution goes through Zapier Catch Hooks (the brief's MVP
 * execution layer). Each request carries provenance and a dedup key; Zapier
 * calls back to /api/webhooks/zapier/todoist with the created task's ID and
 * URL. See ZAPIER_SETUP.md for the exact Zap configuration.
 */

export interface TodoistCreateRequest {
  action: "create";
  deanos_task_id: string | null;
  title: string;
  project_id: string | null; // null → Todoist Inbox (Personal, per brief)
  description: string;
  priority: number; // Todoist semantics: 4 = urgent … 1 = backlog
  due_date: string | null; // YYYY-MM-DD, only when explicitly provided
  labels: string[];
  source_system: string | null;
  source_record_id: string | null;
  source_url: string | null;
  dedup_key: string;
  callback_url: string;
}

export interface TodoistUpdateRequest {
  action: "update";
  todoist_task_id: string;
  title?: string;
  description?: string;
  priority?: number;
  due_date?: string | null;
  project_id?: string | null;
}

export interface TodoistCompleteRequest {
  action: "complete";
  todoist_task_id: string;
}

export interface ZapierSendResult {
  ok: boolean;
  error?: string;
}

async function postToHook(url: string | undefined, body: unknown, hookName: string): Promise<ZapierSendResult> {
  if (!url) {
    return { ok: false, error: `${hookName} is not configured. Set it in the environment.` };
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, error: `Zapier hook returned ${response.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Zapier hook unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function buildCreateRequest(task: Task, business: Business | null): TodoistCreateRequest {
  const env = getEnv();
  return {
    action: "create",
    deanos_task_id: task.id,
    title: task.title,
    project_id: business?.todoist_project_id ?? null,
    description: task.description,
    priority: task.priority,
    due_date: task.due_date ? formatDate(task.due_date) : null,
    labels: task.labels,
    source_system: task.source_system,
    source_record_id: task.source_record_id,
    source_url: task.source_url,
    dedup_key: task.dedup_key,
    callback_url: `${env.APP_URL}/api/webhooks/zapier/todoist`,
  };
}

export async function sendTodoistCreate(request: TodoistCreateRequest): Promise<ZapierSendResult> {
  return postToHook(getEnv().ZAPIER_TODOIST_CREATE_HOOK_URL, request, "ZAPIER_TODOIST_CREATE_HOOK_URL");
}

export async function sendTodoistUpdate(request: TodoistUpdateRequest): Promise<ZapierSendResult> {
  return postToHook(getEnv().ZAPIER_TODOIST_UPDATE_HOOK_URL, request, "ZAPIER_TODOIST_UPDATE_HOOK_URL");
}

export async function sendTodoistComplete(request: TodoistCompleteRequest): Promise<ZapierSendResult> {
  return postToHook(getEnv().ZAPIER_TODOIST_COMPLETE_HOOK_URL, request, "ZAPIER_TODOIST_COMPLETE_HOOK_URL");
}

function formatDate(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}
