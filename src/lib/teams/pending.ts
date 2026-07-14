import { randomUUID } from "node:crypto";
import { ensureOwner, getLastSyncRun, listSyncRunsBySource, recordSyncRun } from "@/lib/db/repo";
import { sendToDeanWithButtons } from "@/lib/telegram/notify";

/**
 * Approval gate for messaging a teammate on Teams. The agent stages the draft
 * here; Dean gets a Telegram card with Send / Cancel and nothing goes to the
 * teammate until he taps Send (handled in the webhook callback).
 */
export interface PendingTeams {
  id: string;
  name: string;
  email: string;
  body: string;
}

export async function stagePendingTeams(p: Omit<PendingTeams, "id">): Promise<{ ok: boolean; id: string }> {
  const owner = await ensureOwner();
  const id = randomUUID().slice(0, 8);
  await recordSyncRun({ userId: owner.user.id, sourceSystem: `pendingteams:${id}`, stats: { ...p, id } });
  const card = `💬 Teams message to ${p.name}\n\n${p.body}\n\nApprove to send:`;
  const ok = await sendToDeanWithButtons(card, [
    [
      { text: "✅ Send", callback_data: `tmsg:send:${id}` },
      { text: "❌ Cancel", callback_data: `tmsg:cancel:${id}` },
    ],
  ]);
  return { ok, id };
}

export async function getPendingTeams(id: string): Promise<PendingTeams | null> {
  if (await getLastSyncRun(`pendingteamsdone:${id}`)) return null;
  const rows = await listSyncRunsBySource(`pendingteams:${id}`, 7);
  const s = rows[0]?.stats as unknown as PendingTeams | undefined;
  return s?.body ? s : null;
}

export async function markPendingTeamsDone(id: string): Promise<void> {
  const owner = await ensureOwner();
  await recordSyncRun({ userId: owner.user.id, sourceSystem: `pendingteamsdone:${id}`, stats: {} });
}
