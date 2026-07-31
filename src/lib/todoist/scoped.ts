import { ensureOwner } from "@/lib/db/repo";
import { listActiveTodoistTasks, type TodoistTask } from "@/lib/todoist/api";

/**
 * Live Todoist tasks scoped to a user. The direct Todoist token is a single,
 * app-global account belonging to the owner (Dean) until per-user Todoist
 * tokens land (Phase 2). So only the owner may read it — every other user gets
 * an empty list, ensuring the owner's tasks never leak across accounts.
 */
export async function listTodoistTasksForUser(userId: string): Promise<TodoistTask[]> {
  const owner = await ensureOwner();
  if (userId !== owner.user.id) return [];
  return listActiveTodoistTasks().catch(() => []);
}
