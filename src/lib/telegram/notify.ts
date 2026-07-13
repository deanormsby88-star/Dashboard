import { getEnv } from "@/lib/env";
import { isTelegramConfigured, sendMessage, sendMessageWithButtons, type InlineButton } from "@/lib/telegram/api";

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

/** Push a message to Dean with tap-to-act inline buttons. */
export async function sendToDeanWithButtons(text: string, buttons: InlineButton[][]): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  const chatId = getEnv().TELEGRAM_ALLOWED_CHAT_ID!;
  const res = await sendMessageWithButtons(chatId, text, buttons);
  return res.ok;
}
