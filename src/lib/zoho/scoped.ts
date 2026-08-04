import { ensureOwner, listSyncRunsBySource, recordSyncRun } from "@/lib/db/repo";
import { listAllTasks, zohoConfigured, type ZohoTask } from "@/lib/zoho/client";

/**
 * Zoho Connect is one shared Heya-org connection (app-global credentials, not
 * per-user) — so, exactly like the Todoist scoping, only the owner may see it.
 * Every other multi-tenant user gets []. Walking all boards/sections/tasks is
 * several API calls, so the result is cached and refreshed by a cron; callers
 * read the cache instantly.
 */

const KEY = "zoho:tasks";

export interface CachedZohoTasks {
  tasks: ZohoTask[];
  fetchedAt: string;
}

export async function syncZohoTasks(now: Date = new Date()): Promise<{ synced: boolean; count?: number; error?: string }> {
  if (!zohoConfigured()) return { synced: false };
  const owner = await ensureOwner();
  try {
    const tasks = await listAllTasks();
    await recordSyncRun({ userId: owner.user.id, sourceSystem: KEY, stats: { tasks, fetchedAt: now.toISOString() } });
    return { synced: true, count: tasks.length };
  } catch (e) {
    return { synced: false, error: e instanceof Error ? e.message : "zoho sync failed" };
  }
}

async function getCachedZohoTasks(): Promise<CachedZohoTasks | null> {
  const rows = await listSyncRunsBySource(KEY, 1).catch(() => []);
  const s = rows[0]?.stats as unknown as CachedZohoTasks | undefined;
  return s && Array.isArray(s.tasks) ? s : null;
}

/** Cached Zoho tasks for a user — [] for anyone but the owner (isolation). */
export async function listZohoTasksForUser(userId: string): Promise<ZohoTask[]> {
  const owner = await ensureOwner();
  if (userId !== owner.user.id) return [];
  const cached = await getCachedZohoTasks();
  return cached?.tasks ?? [];
}

export async function zohoLastSyncedAt(userId: string): Promise<string | null> {
  const owner = await ensureOwner();
  if (userId !== owner.user.id) return null;
  const cached = await getCachedZohoTasks();
  return cached?.fetchedAt ?? null;
}
