import { getEnv } from "@/lib/env";
import { sendMessage, sendMessageWithButtons, type InlineButton } from "@/lib/telegram/api";
import { appendConversationMessage, ensureOwner, getUserById } from "@/lib/db/repo";

/**
 * Per-user Telegram delivery. Each user's proactive messages go to THEIR linked
 * chat; the legacy owner (Dean) falls back to the env TELEGRAM_ALLOWED_CHAT_ID
 * so he keeps working without re-linking. A user who hasn't linked Telegram
 * simply gets no push (returns false) — never another user's chat.
 */

function botConfigured(): boolean {
  return Boolean(getEnv().TELEGRAM_BOT_TOKEN);
}

/** True while a "pause notifications until X" request is still in effect. */
export function isNotificationsPaused(pausedUntil: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!pausedUntil) return false;
  const until = new Date(pausedUntil);
  return !Number.isNaN(until.getTime()) && until.getTime() > now.getTime();
}

/**
 * The Telegram chat id to deliver a given user's messages to (or null), and
 * whether they're currently in a self-requested quiet period. Only PROACTIVE
 * sends (sendToUser/sendToUserWithButtons — briefs, reminders, watch alerts,
 * task nudges, etc.) honour the pause; direct replies to something the user
 * just said go through telegram/api.ts's sendMessage directly and are
 * unaffected, matching "I won't ping you unless you ask directly."
 */
async function deliveryTarget(userId: string): Promise<{ chatId: string | null; paused: boolean }> {
  const owner = await getUserById(userId).catch(() => null);
  if (!owner) return { chatId: null, paused: false };
  const paused = isNotificationsPaused(owner.user.notifications_paused_until);
  if (owner.user.telegram_chat_id) return { chatId: owner.user.telegram_chat_id, paused };
  // Legacy owner fallback: the env-configured chat belongs to DEANOS_EMAIL.
  const env = getEnv();
  if (env.TELEGRAM_ALLOWED_CHAT_ID && owner.user.email.toLowerCase() === env.DEANOS_EMAIL.toLowerCase()) {
    return { chatId: env.TELEGRAM_ALLOWED_CHAT_ID, paused };
  }
  return { chatId: null, paused };
}

/**
 * Record a proactive message into the user's Telegram conversation memory (as
 * an assistant turn), so a short reply — "done", "submitted", "reschedule that"
 * — is understood in context. Best-effort: memory failure never blocks a send.
 */
async function rememberProactive(userId: string, text: string): Promise<void> {
  try {
    await appendConversationMessage({ userId, channel: "telegram", role: "assistant", content: text });
  } catch {
    /* memory is best-effort; the message still went out */
  }
}

/** Push a message to a specific user's Telegram chat. No-op (false) if unlinked or paused. */
export async function sendToUser(userId: string, text: string): Promise<boolean> {
  if (!botConfigured()) return false;
  const { chatId, paused } = await deliveryTarget(userId);
  if (!chatId || paused) return false;
  const res = await sendMessage(chatId, text);
  if (res.ok) await rememberProactive(userId, text);
  return res.ok;
}

/** Push a message with tap-to-act inline buttons to a specific user. */
export async function sendToUserWithButtons(
  userId: string,
  text: string,
  buttons: InlineButton[][]
): Promise<boolean> {
  if (!botConfigured()) return false;
  const { chatId, paused } = await deliveryTarget(userId);
  if (!chatId || paused) return false;
  const res = await sendMessageWithButtons(chatId, text, buttons);
  if (res.ok) await rememberProactive(userId, text);
  return res.ok;
}

/** Back-compat: deliver to the owner (Dean). Prefer sendToUser(userId, …). */
export async function sendToDean(text: string): Promise<boolean> {
  const owner = await ensureOwner();
  return sendToUser(owner.user.id, text);
}

/** Back-compat: deliver to the owner with buttons. Prefer sendToUserWithButtons. */
export async function sendToDeanWithButtons(text: string, buttons: InlineButton[][]): Promise<boolean> {
  const owner = await ensureOwner();
  return sendToUserWithButtons(owner.user.id, text, buttons);
}
