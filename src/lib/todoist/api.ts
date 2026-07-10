import { getEnv } from "@/lib/env";
import type { Business, Task } from "@/lib/types";

/**
 * Direct Todoist API client (unified /api/v1, successor to REST v2 which
 * now returns 410). Used when TODOIST_API_TOKEN is configured — no Zapier
 * tasks consumed, and the created task's ID/URL come back synchronously.
 * Priority semantics match DeanOS/Todoist API: 4 = urgent.
 */

const BASE = "https://api.todoist.com/api/v1";

export interface TodoistApiResult {
  ok: boolean;
  todoistTaskId?: string;
  todoistTaskUrl?: string;
  error?: string;
}

export function buildTodoistCreateBody(task: Task, business: Business | null): Record<string, unknown> {
  const body: Record<string, unknown> = {
    content: task.title,
    description: task.description,
    priority: task.priority,
  };
  // Personal has no validated project ID — omitting project_id targets the Inbox.
  if (business?.todoist_project_id) body.project_id = business.todoist_project_id;
  if (task.due_date) body.due_date = toIsoDate(task.due_date);
  if (task.labels.length > 0) body.labels = task.labels;
  return body;
}

/** pg returns date columns as Date objects; Todoist wants YYYY-MM-DD. */
function toIsoDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function todoistFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${getEnv().TODOIST_API_TOKEN}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

export async function createTodoistTask(task: Task, business: Business | null): Promise<TodoistApiResult> {
  try {
    const res = await todoistFetch("/tasks", {
      method: "POST",
      body: JSON.stringify(buildTodoistCreateBody(task, business)),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Todoist API error ${res.status}: ${text.slice(0, 300)}` };
    }
    const created = (await res.json()) as { id: string | number; url?: string };
    return {
      ok: true,
      todoistTaskId: String(created.id),
      todoistTaskUrl: created.url ?? `https://app.todoist.com/app/task/${created.id}`,
    };
  } catch (err) {
    return { ok: false, error: `Todoist API unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function updateTodoistTask(
  todoistTaskId: string,
  fields: { title?: string; description?: string; priority?: number; due_date?: string | null }
): Promise<TodoistApiResult> {
  const body: Record<string, unknown> = {};
  if (fields.title !== undefined) body.content = fields.title;
  if (fields.description !== undefined) body.description = fields.description;
  if (fields.priority !== undefined) body.priority = fields.priority;
  if (fields.due_date !== undefined) {
    if (fields.due_date === null) body.due_string = "no date";
    else body.due_date = fields.due_date;
  }
  try {
    const res = await todoistFetch(`/tasks/${todoistTaskId}`, { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) return { ok: false, error: `Todoist API error ${res.status}` };
    return { ok: true, todoistTaskId };
  } catch (err) {
    return { ok: false, error: `Todoist API unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function closeTodoistTask(todoistTaskId: string): Promise<TodoistApiResult> {
  try {
    const res = await todoistFetch(`/tasks/${todoistTaskId}/close`, { method: "POST" });
    if (!res.ok && res.status !== 404) return { ok: false, error: `Todoist API error ${res.status}` };
    return { ok: true, todoistTaskId };
  } catch (err) {
    return { ok: false, error: `Todoist API unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}
