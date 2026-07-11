import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { recordWebhookEvent, updateWebhookEvent } from "@/lib/db/repo";
import { runCommand } from "@/lib/assistant/commands";
import { sendChatAction, sendMessage } from "@/lib/telegram/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ENDPOINT = "telegram";

/**
 * Telegram bot webhook. Telegram POSTs updates here and authenticates by
 * echoing our secret in X-Telegram-Bot-Api-Secret-Token. Only Dean's chat is
 * allowed; every other message is ignored. Each update_id is processed once
 * (idempotent against Telegram's retries). The message text runs through the
 * same Assistant engine as the web app, and the reply is sent back.
 */
export async function POST(request: NextRequest) {
  const env = getEnv();

  // Bot not configured → accept-and-ignore so Telegram stops retrying.
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_ALLOWED_CHAT_ID) {
    return NextResponse.json({ ok: true, ignored: "not configured" });
  }
  if (request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Invalid secret token." }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as {
    update_id?: number;
    message?: { text?: string; chat?: { id?: number | string } };
  } | null;

  const chatId = update?.message?.chat?.id;
  const text = update?.message?.text?.trim();
  // Always 200 for updates we can't act on, so Telegram doesn't retry forever.
  if (!update?.update_id || chatId === undefined || !text) {
    return NextResponse.json({ ok: true });
  }
  if (String(chatId) !== String(env.TELEGRAM_ALLOWED_CHAT_ID)) {
    // Someone else found the bot. Politely decline, once.
    await sendMessage(String(chatId), "This is a private assistant.").catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // Idempotency: one update_id processed once.
  const event = await recordWebhookEvent({
    endpoint: ENDPOINT,
    idempotencyKey: `${ENDPOINT}:${update.update_id}`,
    payload: update,
    rawBody: null,
  });
  if (event.duplicate) return NextResponse.json({ ok: true, duplicate: true });

  try {
    await sendChatAction(String(chatId), "typing");
    const { reply } = await runCommand(text, "telegram");
    await sendMessage(String(chatId), reply);
    await updateWebhookEvent(event.id, "processed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateWebhookEvent(event.id, "failed", message);
    await sendMessage(String(chatId), `Something went wrong: ${message}`).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
