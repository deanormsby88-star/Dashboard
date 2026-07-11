import { getEnv } from "@/lib/env";
import { isTelegramConfigured, sendMessage } from "@/lib/telegram/api";

/**
 * Push a message to Dean's Telegram chat. No-op (returns false) when the bot
 * isn't configured, so callers can fire-and-forget without guarding.
 */
export async function sendToDean(text: string): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  const chatId = getEnv().TELEGRAM_ALLOWED_CHAT_ID!;
  const res = await sendMessage(chatId, text);
  return res.ok;
}
