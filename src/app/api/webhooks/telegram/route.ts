import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { recordWebhookEvent, updateWebhookEvent } from "@/lib/db/repo";
import { runCommand } from "@/lib/assistant/commands";
import { answerCallbackQuery, downloadFile, editMessageText, getFilePath, sendChatAction, sendMessage } from "@/lib/telegram/api";
import { transcribeAudio } from "@/lib/ai/openai";
import { approveSuggestedTask, rejectSuggestedTask } from "@/lib/tasks/review";
import { getPendingEmail, markPendingDone } from "@/lib/email/pending";
import { getValidAccessToken, replyToMessage, sendNewMessage } from "@/lib/calendar/microsoft";
import { signedEmailBody } from "@/lib/email/signature";

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
    message?: {
      text?: string;
      chat?: { id?: number | string };
      voice?: { file_id?: string; mime_type?: string };
      audio?: { file_id?: string; mime_type?: string };
      reply_to_message?: { text?: string; caption?: string };
    };
    callback_query?: {
      id: string;
      data?: string;
      message?: { message_id?: number; chat?: { id?: number | string }; text?: string };
    };
  } | null;

  // ── Button taps (Approve/Reject on a task card) ──────────────────────────
  if (update?.callback_query) {
    return handleCallback(update.update_id, update.callback_query, env.TELEGRAM_ALLOWED_CHAT_ID);
  }

  const chatId = update?.message?.chat?.id;
  const voice = update?.message?.voice ?? update?.message?.audio;
  const text = update?.message?.text?.trim();
  // If Dean reply-quotes a message (e.g. a meeting reminder), that quoted text
  // is the referent for "this" — carry it through as context, or the agent
  // has nothing to anchor on.
  const quoted = (update?.message?.reply_to_message?.text ?? update?.message?.reply_to_message?.caption)?.trim();
  // Need a chat and either text or a voice note; otherwise 200-and-ignore.
  if (!update?.update_id || chatId === undefined || (!text && !voice?.file_id)) {
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

    // Voice note → transcribe, then treat the transcript as the message.
    let messageText = text ?? "";
    if (!messageText && voice?.file_id) {
      const path = await getFilePath(voice.file_id);
      const bytes = path ? await downloadFile(path) : null;
      if (!bytes) {
        await sendMessage(String(chatId), "I couldn't fetch that voice note — mind trying again?");
        await updateWebhookEvent(event.id, "failed", "voice download failed");
        return NextResponse.json({ ok: true });
      }
      const ext = (path!.split(".").pop() || "ogg").toLowerCase();
      const tr = await transcribeAudio({
        bytes,
        filename: `voice.${ext}`,
        mimeType: voice.mime_type ?? "audio/ogg",
      });
      if (!tr.ok || !tr.text) {
        await sendMessage(String(chatId), "I couldn't make out that voice note — try again or type it?");
        await updateWebhookEvent(event.id, "failed", tr.error ?? "empty transcription");
        return NextResponse.json({ ok: true });
      }
      messageText = tr.text;
    }

    // Prepend the quoted message so "this / that" has a referent.
    const finalText = quoted
      ? `[Replying to this earlier message:\n"${quoted}"]\n\n${messageText}`
      : messageText;

    const { reply } = await runCommand(finalText, "telegram");
    await sendMessage(String(chatId), reply);
    await updateWebhookEvent(event.id, "processed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateWebhookEvent(event.id, "failed", message);
    await sendMessage(String(chatId), `Something went wrong: ${message}`).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}

/** Handle an inline-button tap: approve/reject a task, then update the card. */
async function handleCallback(
  updateId: number | undefined,
  cb: { id: string; data?: string; message?: { message_id?: number; chat?: { id?: number | string }; text?: string } },
  allowedChatId: string
): Promise<NextResponse> {
  const cbChat = cb.message?.chat?.id;
  if (cbChat === undefined || String(cbChat) !== String(allowedChatId)) {
    await answerCallbackQuery(cb.id).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // Idempotency: one callback processed once (Telegram retries).
  if (updateId) {
    const event = await recordWebhookEvent({
      endpoint: ENDPOINT,
      idempotencyKey: `${ENDPOINT}:cb:${updateId}`,
      payload: cb,
      rawBody: null,
    });
    if (event.duplicate) {
      await answerCallbackQuery(cb.id).catch(() => {});
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  // Email approval buttons.
  const emailMatch = /^email:(send|cancel):(.+)$/.exec(cb.data ?? "");
  if (emailMatch) {
    return handleEmailCallback(cb, emailMatch[1] as "send" | "cancel", emailMatch[2], String(cbChat));
  }

  const match = /^task:(approve|reject):(.+)$/.exec(cb.data ?? "");
  if (!match) {
    await answerCallbackQuery(cb.id, "Unknown action").catch(() => {});
    return NextResponse.json({ ok: true });
  }
  const [, action, taskId] = match;
  const result = action === "approve" ? await approveSuggestedTask(taskId) : await rejectSuggestedTask(taskId);

  const original = cb.message?.text ?? "Task";
  const title = result.title ?? "task";
  let toast: string;
  let newText: string;
  if (result.ok && action === "approve") {
    toast = "Approved — sent to Todoist";
    newText = `✅ Approved · ${title}`;
  } else if (result.ok) {
    toast = "Rejected";
    newText = `❌ Rejected · ${title}`;
  } else {
    toast = result.error ?? "Couldn't do that";
    newText = `${original}\n\n⚠️ ${result.error ?? "action failed"}`;
  }

  await answerCallbackQuery(cb.id, toast).catch(() => {});
  if (cb.message?.message_id !== undefined) {
    await editMessageText(String(cbChat), cb.message.message_id, newText).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}

/** Send or cancel a staged email when Dean taps the button. */
async function handleEmailCallback(
  cb: { id: string; message?: { message_id?: number } },
  action: "send" | "cancel",
  id: string,
  chatId: string
): Promise<NextResponse> {
  const pending = await getPendingEmail(id);
  if (!pending) {
    await answerCallbackQuery(cb.id, "This draft has expired or was already handled").catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel") {
    await markPendingDone(id);
    await answerCallbackQuery(cb.id, "Cancelled").catch(() => {});
    if (cb.message?.message_id !== undefined) await editMessageText(chatId, cb.message.message_id, "❌ Draft cancelled — not sent.").catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // Send.
  const { ensureOwner } = await import("@/lib/db/repo");
  const owner = await ensureOwner();
  const token = await getValidAccessToken(owner.user.id, pending.mailbox);
  if (!token) {
    await answerCallbackQuery(cb.id, `${pending.mailbox} not connected`).catch(() => {});
    return NextResponse.json({ ok: true });
  }
  try {
    const { html, attachments } = await signedEmailBody(pending.mailbox, pending.body);
    if (pending.kind === "reply" && pending.messageId) {
      await replyToMessage(token, pending.messageId, pending.body, html, attachments);
    } else {
      await sendNewMessage(token, {
        to: pending.to ?? [],
        subject: pending.subject ?? "",
        body: pending.body,
        html,
        attachments,
      });
    }
    await markPendingDone(id);
    await answerCallbackQuery(cb.id, "Sent ✅").catch(() => {});
    if (cb.message?.message_id !== undefined) {
      await editMessageText(chatId, cb.message.message_id, `✅ Sent (${pending.mailbox.toUpperCase()})`).catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "send failed";
    await answerCallbackQuery(cb.id, `Send failed: ${msg}`.slice(0, 190)).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
