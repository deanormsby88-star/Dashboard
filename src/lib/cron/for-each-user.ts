import { getUserById, listAllUsers, type Owner } from "@/lib/db/repo";

/**
 * Run a background job once per user. Loads each user's full context (Owner)
 * and invokes fn; a failure for one user never aborts the others. Returns each
 * user's result alongside their id for the cron's JSON response.
 */
export async function forEachUser<T>(
  fn: (owner: Owner) => Promise<T>
): Promise<Array<{ userId: string; ok: boolean; result?: T; error?: string }>> {
  const users = await listAllUsers();
  const out: Array<{ userId: string; ok: boolean; result?: T; error?: string }> = [];
  for (const u of users) {
    const owner = await getUserById(u.id).catch(() => null);
    if (!owner) continue;
    try {
      out.push({ userId: u.id, ok: true, result: await fn(owner) });
    } catch (err) {
      out.push({ userId: u.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
