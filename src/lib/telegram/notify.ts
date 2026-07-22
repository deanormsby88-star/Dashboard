import { getEnv } from "@/lib/env";
import { isTelegramConfigured, sendMessage, sendMessageWithButtons, type InlineButton } from "@/lib/telegram/api";
import { appendConversationMessage, ensureOwner } from "@/lib/db/repo";

/**
 * Record a proactive message the bot sent Dean into the Telegram conversation
 * memory (as an assistant turn), so when he replies — "it's been submitted",
 * "done", "reschedule that" — the agent understands his reply in the context of
 * what it last said, instead of picking up a stale earlier thread. Best-effort:
 * a memory failure must never block the actual send.
 */
async function rememberProactive(text: string): Promise<void> {
  try {
    const owner = await ensureOwner();
    await appendConversationMessage({ userId: owner.user.id, channel: "telegram", role: "assistant", content: text });
  } catch {
    /* memory is best-effort; the message still went out */
  }
}

/**
 * Push a message to Dean's Telegram chat. No-op (returns false) when the bot
 * isn't configured, so callers can fire-and-forget without guarding.
 */
export async function sendToDean(text: string): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  const chatId = getEnv().TELEGRAM_ALLOWED_CHAT_ID!;
  const res = await sendMessage(chatId, text);
  if (res.ok) await rememberProactive(text);
  return res.ok;
}

/** Push a message to Dean with tap-to-act inline buttons. */
export async function sendToDeanWithButtons(text: string, buttons: InlineButton[][]): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  const chatId = getEnv().TELEGRAM_ALLOWED_CHAT_ID!;
  const res = await sendMessageWithButtons(chatId, text, buttons);
  if (res.ok) await rememberProactive(text);
  return res.ok;
}
