import { randomUUID } from "node:crypto";
import { ensureOwner, getLastSyncRun, listSyncRunsBySource, recordSyncRun } from "@/lib/db/repo";
import { sendToDeanWithButtons } from "@/lib/telegram/notify";

/**
 * Human-in-the-loop email sending: the agent stages a draft here and Dean gets
 * a Telegram card with Send / Cancel buttons. Nothing is sent until he taps
 * Send (handled in the Telegram webhook callback). Stored on sync_runs.
 */
export interface PendingEmail {
  id: string;
  kind: "reply" | "new";
  mailbox: "heya" | "jic";
  messageId?: string; // for replies
  to?: string[]; // for new mail
  subject?: string;
  body: string;
}

/** Stage a draft and send Dean the approval card. Returns whether it was shown. */
export async function stagePendingEmail(p: Omit<PendingEmail, "id">): Promise<{ ok: boolean; id: string }> {
  const owner = await ensureOwner();
  const id = randomUUID().slice(0, 8);
  await recordSyncRun({ userId: owner.user.id, sourceSystem: `pendingemail:${id}`, stats: { ...p, id } });

  const header =
    p.kind === "reply"
      ? `✉️ Draft reply — ${p.mailbox.toUpperCase()}`
      : `✉️ Draft email — ${p.mailbox.toUpperCase()} to ${(p.to ?? []).join(", ")}`;
  const subj = p.subject ? `\nSubject: ${p.subject}` : "";
  const card = `${header}${subj}\n\n${p.body}\n\nApprove to send:`;
  const ok = await sendToDeanWithButtons(card, [
    [
      { text: "✅ Send", callback_data: `email:send:${id}` },
      { text: "❌ Cancel", callback_data: `email:cancel:${id}` },
    ],
  ]);
  return { ok, id };
}

/** Load a staged email if still pending (not yet sent/cancelled). */
export async function getPendingEmail(id: string): Promise<PendingEmail | null> {
  if (await getLastSyncRun(`pendingemaildone:${id}`)) return null;
  const rows = await listSyncRunsBySource(`pendingemail:${id}`, 7);
  const s = rows[0]?.stats as unknown as PendingEmail | undefined;
  return s?.body ? s : null;
}

/** Mark a staged email resolved (sent or cancelled) so it can't fire twice. */
export async function markPendingDone(id: string): Promise<void> {
  const owner = await ensureOwner();
  await recordSyncRun({ userId: owner.user.id, sourceSystem: `pendingemaildone:${id}`, stats: {} });
}
