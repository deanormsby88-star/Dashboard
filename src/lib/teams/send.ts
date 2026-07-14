import { ensureOwner } from "@/lib/db/repo";
import {
  ensureOneOnOneChat,
  getMyId,
  getValidAccessToken,
  resolveTeamsUser,
  sendTeamsChatMessage,
} from "@/lib/calendar/microsoft";

/**
 * Send a Teams message to a teammate as Dean (Heya tenant). Resolves the
 * teammate by email, opens/creates the 1:1 chat, and posts the message.
 */
export async function messageTeammate(email: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const owner = await ensureOwner();
  const token = await getValidAccessToken(owner.user.id, "heya");
  if (!token) return { ok: false, error: "Heya Teams not connected" };
  try {
    const [myId, otherId] = await Promise.all([getMyId(token), resolveTeamsUser(token, email)]);
    if (!myId) return { ok: false, error: "couldn't resolve your Teams identity" };
    if (!otherId) return { ok: false, error: `couldn't find ${email} on Teams` };
    const chatId = await ensureOneOnOneChat(token, myId, otherId);
    if (!chatId) return { ok: false, error: "couldn't open a Teams chat" };
    await sendTeamsChatMessage(token, chatId, text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Teams send failed" };
  }
}
