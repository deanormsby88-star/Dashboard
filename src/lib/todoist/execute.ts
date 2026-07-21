import { getEnv } from "@/lib/env";
import type { Business, Task } from "@/lib/types";
import { closeTodoistTask, createTodoistTask, updateTodoistTask } from "@/lib/todoist/api";
import {
  buildCreateRequest,
  sendTodoistComplete,
  sendTodoistCreate,
  sendTodoistUpdate,
} from "@/lib/todoist/zapier";

/**
 * Single entry point for Todoist execution. Prefers the direct Todoist API
 * (TODOIST_API_TOKEN) — zero Zapier cost, synchronous IDs — and falls back
 * to the Zapier Catch Hooks when the token isn't configured.
 */

export interface ExecuteCreateResult {
  ok: boolean;
  error?: string;
  /** Set when the task was created synchronously (direct API). Null means
   *  it was dispatched via Zapier and the callback will deliver the ID. */
  created: { todoistTaskId: string; todoistTaskUrl: string | null } | null;
}

export function isDirectTodoist(): boolean {
  return Boolean(getEnv().TODOIST_API_TOKEN);
}

export async function executeCreate(
  task: Task,
  business: Business | null,
  deadlineDate?: string | null
): Promise<ExecuteCreateResult> {
  if (isDirectTodoist()) {
    const result = await createTodoistTask(task, business, deadlineDate);
    if (!result.ok) return { ok: false, error: result.error, created: null };
    return {
      ok: true,
      created: { todoistTaskId: result.todoistTaskId!, todoistTaskUrl: result.todoistTaskUrl ?? null },
    };
  }
  const sent = await sendTodoistCreate(buildCreateRequest(task, business));
  return sent.ok ? { ok: true, created: null } : { ok: false, error: sent.error, created: null };
}

export async function executeUpdate(params: {
  todoistTaskId: string;
  title?: string;
  description?: string;
  priority?: number;
  due_date?: string | null;
  project_id?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (isDirectTodoist()) {
    const result = await updateTodoistTask(params.todoistTaskId, params);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }
  const sent = await sendTodoistUpdate({
    action: "update",
    todoist_task_id: params.todoistTaskId,
    title: params.title,
    description: params.description,
    priority: params.priority,
    due_date: params.due_date,
    project_id: params.project_id,
  });
  return sent.ok ? { ok: true } : { ok: false, error: sent.error };
}

export async function executeComplete(todoistTaskId: string): Promise<{ ok: boolean; error?: string }> {
  if (isDirectTodoist()) {
    const result = await closeTodoistTask(todoistTaskId);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }
  const sent = await sendTodoistComplete({ action: "complete", todoist_task_id: todoistTaskId });
  return sent.ok ? { ok: true } : { ok: false, error: sent.error };
}
