import {
  ensureOwner,
  getTask,
  markTaskCreatedByDedupKey,
  setTaskStatus,
} from "@/lib/db/repo";
import { executeCreate } from "@/lib/todoist/execute";

/**
 * Approve a suggested task → send it to Todoist. Guards against double-approve
 * (only acts while still 'suggested') so a repeat tap can't create duplicates.
 */
export async function approveSuggestedTask(taskId: string): Promise<{ ok: boolean; title?: string; error?: string }> {
  const task = await getTask(taskId);
  if (!task) return { ok: false, error: "Task not found." };
  if (task.status !== "suggested") return { ok: false, title: task.title, error: `already ${task.status}` };

  const owner = await ensureOwner();
  const business = owner.businesses.find((b) => b.id === task.business_id) ?? null;
  await setTaskStatus(task.id, "approved");
  const sent = await executeCreate(task, business);
  if (!sent.ok) {
    await setTaskStatus(task.id, "failed", sent.error);
    return { ok: false, title: task.title, error: sent.error };
  }
  if (sent.created) {
    await markTaskCreatedByDedupKey({
      taskId: task.id,
      todoistTaskId: sent.created.todoistTaskId,
      todoistTaskUrl: sent.created.todoistTaskUrl,
    });
  } else {
    await setTaskStatus(task.id, "sent");
  }
  return { ok: true, title: task.title };
}

/** Reject/dismiss a suggested task. */
export async function rejectSuggestedTask(taskId: string): Promise<{ ok: boolean; title?: string; error?: string }> {
  const task = await getTask(taskId);
  if (!task) return { ok: false, error: "Task not found." };
  if (task.status !== "suggested") return { ok: false, title: task.title, error: `already ${task.status}` };
  await setTaskStatus(task.id, "rejected", "Rejected via Telegram.");
  return { ok: true, title: task.title };
}
