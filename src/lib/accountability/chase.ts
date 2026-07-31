import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { callText } from "@/lib/ai/openai";
import { DEAN_VOICE } from "@/lib/voice";
import { getLastSyncRun, listSyncRunsBySource, recordSyncRun } from "@/lib/db/repo";
import type { Commitment } from "@/lib/types";
import type { Owner } from "@/lib/db/repo";

/**
 * A pre-drafted chase, staged for one-tap approval (Assertive mode). The draft
 * is shown inline in the nudge, so tapping Send is the approval — nothing goes
 * out unseen. Stored on sync_runs, mirroring email/pending.ts.
 */
export interface PendingChase {
  id: string;
  commitmentId: string;
  direction: Commitment["direction"];
  personName: string;
  personEmail: string;
  businessKey: "heya" | "jic";
  subject: string;
  draft: string;
}

const CHASE_SYSTEM = `You draft a very short chase / follow-up message from Dean Ormsby about one outstanding item.

${DEAN_VOICE}

Rules:
- 1–3 sentences, warm and professional, never pushy.
- If it is something Dean owes, acknowledge it and give a brief status/next step.
- If it is something owed to Dean, gently ask for it or an ETA.
- No subject line, no signature. Return ONLY the message text.`;

/** Draft the chase text for a commitment via the assistant. */
export async function draftChase(
  commitment: Pick<Commitment, "direction" | "text">,
  personName: string,
  businessDaysStale: number
): Promise<string | null> {
  const owed = commitment.direction === "by_dean" ? "Dean owes this to them" : "they owe this to Dean";
  const res = await callText({
    model: getEnv().OPENAI_MODEL_PRIORITIZER,
    system: CHASE_SYSTEM,
    user: `Recipient: ${personName}
Item: ${commitment.text}
Direction: ${owed}
Outstanding for: ${businessDaysStale} business day(s)`,
    maxOutputTokens: 250,
  });
  return res.ok ? res.rawText?.trim() ?? null : null;
}

/** Stage a drafted chase and return its short id (embedded in button data). */
export async function stagePendingChase(owner: Owner, p: Omit<PendingChase, "id">): Promise<string> {
  const id = randomUUID().slice(0, 8);
  await recordSyncRun({ userId: owner.user.id, sourceSystem: `pendingchase:${id}`, stats: { ...p, id } });
  return id;
}

/** Load a staged chase if still pending (not yet sent/cancelled). */
export async function getPendingChase(id: string): Promise<PendingChase | null> {
  if (await getLastSyncRun(`pendingchasedone:${id}`)) return null;
  const rows = await listSyncRunsBySource(`pendingchase:${id}`, 7);
  const s = rows[0]?.stats as unknown as PendingChase | undefined;
  return s?.draft ? s : null;
}

/** Mark a staged chase resolved so its buttons can't fire twice. */
export async function markChaseDone(owner: Owner, id: string): Promise<void> {
  await recordSyncRun({ userId: owner.user.id, sourceSystem: `pendingchasedone:${id}`, stats: {} });
}
