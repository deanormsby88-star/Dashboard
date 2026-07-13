import { getEnv } from "@/lib/env";

/**
 * Minimal Telegram Bot API client. All methods no-op-fail gracefully when the
 * bot isn't configured. Telegram caps messages at 4096 chars, so sendMessage
 * splits long replies on line boundaries.
 */

const TELEGRAM_MAX = 4096;

function apiUrl(method: string): string | null {
  const token = getEnv().TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  return `https://api.telegram.org/bot${token}/${method}`;
}

export function isTelegramConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ALLOWED_CHAT_ID);
}

/** Split text into <=4096-char chunks, preferring line breaks. */
export function chunkMessage(text: string, max: number = TELEGRAM_MAX): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    // A single over-long line: hard-split it.
    if (line.length > max) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < line.length; i += max) chunks.push(line.slice(i, i + max));
      continue;
    }
    if (current.length + line.length + 1 > max) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export interface TelegramResult {
  ok: boolean;
  error?: string;
}

async function call(method: string, body: unknown): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  const url = apiUrl(method);
  if (!url) return { ok: false, error: "Telegram bot token not configured." };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok: boolean; description?: string; result?: unknown }
      | null;
    if (!data?.ok) return { ok: false, error: data?.description ?? `HTTP ${res.status}` };
    return { ok: true, result: data.result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendMessage(chatId: string, text: string): Promise<TelegramResult> {
  for (const chunk of chunkMessage(text)) {
    const res = await call("sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    });
    if (!res.ok) return res;
  }
  return { ok: true };
}

export async function sendChatAction(chatId: string, action = "typing"): Promise<void> {
  await call("sendChatAction", { chat_id: chatId, action });
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

/** Send a message with an inline-keyboard (tap-to-act buttons). Single message. */
export async function sendMessageWithButtons(
  chatId: string,
  text: string,
  buttons: InlineButton[][]
): Promise<TelegramResult> {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buttons },
  });
}

/** Acknowledge a button tap (stops Telegram's spinner; optional toast text). */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

/** Replace a message's text and drop its buttons — used to show the outcome. */
export async function editMessageText(chatId: string, messageId: number, text: string): Promise<void> {
  await call("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup: { inline_keyboard: [] } });
}

export async function setWebhook(url: string, secretToken: string): Promise<TelegramResult> {
  return call("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

export async function getWebhookInfo(): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  return call("getWebhookInfo", {});
}

export async function getMe(): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  return call("getMe", {});
}

/** Resolve a file_id to a downloadable file_path. */
export async function getFilePath(fileId: string): Promise<string | null> {
  const res = await call("getFile", { file_id: fileId });
  const r = res.result as { file_path?: string } | undefined;
  return res.ok && r?.file_path ? r.file_path : null;
}

/** Download a Telegram file's bytes by its file_path. */
export async function downloadFile(filePath: string): Promise<ArrayBuffer | null> {
  const token = getEnv().TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}
