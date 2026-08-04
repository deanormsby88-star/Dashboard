import { decryptSecret } from "@/lib/crypto";
import { getGarminConnection, listSyncRunsBySource, recordSyncRun } from "@/lib/db/repo";
import { garminSnapshot, type GarminSnapshot } from "@/lib/garmin/client";
import type { Owner } from "@/lib/db/repo";

/**
 * Garmin login is the fragile, rate-sensitive step, so we fetch a snapshot a
 * few times a day and cache it on sync_runs (keyed per user). The brief and the
 * display read the cache instantly — never logging into Garmin on render.
 */

const key = (userId: string) => `garmin:snapshot:${userId}`;

export type CachedGarminSnapshot = GarminSnapshot & { fetchedAt: string };

/** Fetch and cache the user's Garmin snapshot. No-op if not connected. */
export async function syncGarminSnapshot(owner: Owner, now: Date = new Date()): Promise<{ synced: boolean; error?: string }> {
  const conn = await getGarminConnection(owner.user.id);
  if (!conn) return { synced: false };
  try {
    const snap = await garminSnapshot(conn.username, decryptSecret(conn.password_enc), now);
    await recordSyncRun({
      userId: owner.user.id,
      sourceSystem: key(owner.user.id),
      stats: { ...snap, fetchedAt: now.toISOString() },
    });
    return { synced: true };
  } catch (e) {
    return { synced: false, error: e instanceof Error ? e.message : "garmin sync failed" };
  }
}

/** Latest cached snapshot for a user, or null if none / not connected. */
export async function getCachedGarminSnapshot(userId: string): Promise<CachedGarminSnapshot | null> {
  const rows = await listSyncRunsBySource(key(userId), 1).catch(() => []);
  const s = rows[0]?.stats as unknown as CachedGarminSnapshot | undefined;
  return s && typeof s === "object" && "fetchedAt" in s ? s : null;
}
