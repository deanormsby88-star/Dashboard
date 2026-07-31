import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import {
  ensureOwner,
  getUserById,
  getUserByTelegramChatId,
  markCommitmentDone,
  recordSyncRun,
  recordWebhookEvent,
  setUserTelegramChat,
  updateWebhookEvent,
  type Owner,
} from "@/lib/db/repo";
import { verifyLinkCode } from "@/lib/telegram/link";
import { runCommand } from "@/lib/assistant/commands";
import { answerCallbackQuery, downloadFile, editMessageText, getFilePath, sendChatAction, sendMessage } from "@/lib/telegram/api";
import { transcriptionFilename, transcriptionMimeType } from "@/lib/telegram/audio";
import { transcribeAudio } from "@/lib/ai/openai";
import { approveSuggestedTask, rejectSuggestedTask } from "@/lib/tasks/review";
import {
  clearAwaitingDeadline,
  getAwaitingDeadline,
  localDateSAST,
  resolveDeadlineDate,
  setAwaitingDeadline,
} from "@/lib/tasks/deadline";
import { getPendingEmail, markPendingDone, stagePendingEmail } from "@/lib/email/pending";
import { getValidAccessToken, replyToMessage, sendNewMessage } from "@/lib/calendar/microsoft";
import { signedEmailBody } from "@/lib/email/signature";
import { getPendingTeams, markPendingTeamsDone } from "@/lib/teams/pending";
import { messageTeammate, messageTeammateForUser } from "@/lib/teams/send";
import { getPendingChase, markChaseDone } from "@/lib/accountability/chase";
import { getPendingDeadline, markDeadlineDone } from "@/lib/deadlines/scan";
import { createReminder } from "@/lib/assistant/adhoc-reminders";
import { getPendingOffer, markOfferDone, sendAttendeeReminders } from "@/lib/teams/attendee-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ENDPOINT = "telegram";

/** Resolve the DeanOS user for an incoming Telegram chat, or null if unlinked. */
async function resolveTelegramUser(chatId: string): Promise<Owner | null> {
  const byChat = await getUserByTelegramChatId(chatId).catch(() => null);
  if (byChat) return getUserById(byChat.id);
  // Legacy owner: the env-configured chat belongs to Dean, no linking needed.
  const env = getEnv();
  if (env.TELEGRAM_ALLOWED_CHAT_ID && String(chatId) === String(env.TELEGRAM_ALLOWED_CHAT_ID)) {
    return ensureOwner();
  }
  return null;
}

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
  // (ALLOWED_CHAT_ID is optional now — it's only the legacy-owner fallback.)
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
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
    return handleCallback(update.update_id, update.callback_query);
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

  // Idempotency: one update_id processed once.
  const event = await recordWebhookEvent({
    endpoint: ENDPOINT,
    idempotencyKey: `${ENDPOINT}:${update.update_id}`,
    payload: update,
    rawBody: null,
  });
  if (event.duplicate) return NextResponse.json({ ok: true, duplicate: true });

  // Account linking: `/start <code>` binds this chat to a DeanOS user.
  if (text?.startsWith("/start")) {
    const code = text.slice("/start".length).trim();
    const linkedUserId = code ? verifyLinkCode(code) : null;
    if (linkedUserId) {
      await setUserTelegramChat(linkedUserId, String(chatId)).catch(() => {});
      await sendMessage(String(chatId), "✅ Linked — your DeanOS assistant will message you here. Try “what’s on today”.");
    } else {
      const already = await resolveTelegramUser(String(chatId));
      await sendMessage(
        String(chatId),
        already
          ? "You’re already linked. Try “what’s on today” or send a voice note."
          : "To connect your account, open DeanOS → Settings → Connect Telegram and tap the link there."
      );
    }
    await updateWebhookEvent(event.id, "processed");
    return NextResponse.json({ ok: true });
  }

  // Route the message to the linked user; decline unlinked chats.
  const owner = await resolveTelegramUser(String(chatId));
  if (!owner) {
    await sendMessage(
      String(chatId),
      "This chat isn’t linked to a DeanOS account. Open DeanOS → Settings → Connect Telegram to link it."
    ).catch(() => {});
    await updateWebhookEvent(event.id, "processed");
    return NextResponse.json({ ok: true });
  }

  try {
    await sendChatAction(String(chatId), "typing");

    // Voice note → transcribe, then treat the transcript as the message.
    let messageText = text ?? "";
    let fromVoice = false;
    if (!messageText && voice?.file_id) {
      fromVoice = true;
      const path = await getFilePath(voice.file_id);
      const bytes = path ? await downloadFile(path) : null;
      if (!bytes) {
        await sendMessage(String(chatId), "I couldn't fetch that voice note — mind trying again?");
        await updateWebhookEvent(event.id, "failed", "voice download failed");
        return NextResponse.json({ ok: true });
      }
      const tr = await transcribeAudio({
        bytes,
        // Telegram voice notes download as `.oga`, which OpenAI rejects — map
        // to a supported container (`.ogg`) so transcription actually runs.
        filename: transcriptionFilename(path!, voice.mime_type),
        mimeType: transcriptionMimeType(voice.mime_type),
      });
      if (!tr.ok || !tr.text) {
        await sendMessage(String(chatId), "I couldn't make out that voice note — try again or type it?");
        await updateWebhookEvent(event.id, "failed", tr.error ?? "empty transcription");
        return NextResponse.json({ ok: true });
      }
      messageText = tr.text;
    }

    // If Dean tapped "Pick a date" on a task card, his next reply is the
    // deadline — resolve it and approve, rather than sending it to the agent.
    const awaiting = await getAwaitingDeadline().catch(() => null);
    if (awaiting && messageText) {
      const deadline = await resolveDeadlineDate(messageText).catch(() => null);
      if (deadline) {
        await clearAwaitingDeadline().catch(() => {});
        const res = await approveSuggestedTask(owner, awaiting.taskId, deadline);
        const reply = res.ok
          ? `✅ Approved with deadline ${deadline}: ${res.title ?? awaiting.title}`
          : `Couldn't set that deadline: ${res.error ?? "unknown error"}`;
        await sendMessage(String(chatId), reply);
        await updateWebhookEvent(event.id, "processed");
        return NextResponse.json({ ok: true });
      }
      // Not a date → abandon the deadline capture and handle the message normally.
      await clearAwaitingDeadline().catch(() => {});
    }

    // Prepend the quoted message so "this / that" has a referent.
    const finalText = quoted
      ? `[Replying to this earlier message:\n"${quoted}"]\n\n${messageText}`
      : messageText;

    const { reply } = await runCommand(finalText, "telegram", owner);
    // For voice notes, echo what was heard so Dean can confirm it understood
    // him — and so any mis-hear is obvious rather than silent.
    const out = fromVoice ? `🎤 “${messageText}”\n\n${reply}` : reply;
    await sendMessage(String(chatId), out);
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
  cb: { id: string; data?: string; message?: { message_id?: number; chat?: { id?: number | string }; text?: string } }
): Promise<NextResponse> {
  const cbChat = cb.message?.chat?.id;
  if (cbChat === undefined) {
    await answerCallbackQuery(cb.id).catch(() => {});
    return NextResponse.json({ ok: true });
  }
  // Only a linked user's chat may act on buttons.
  const owner = await resolveTelegramUser(String(cbChat));
  if (!owner) {
    await answerCallbackQuery(cb.id, "Link your DeanOS account first").catch(() => {});
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

  // Teams-message approval buttons.
  const teamsMatch = /^tmsg:(send|cancel):(.+)$/.exec(cb.data ?? "");
  if (teamsMatch) {
    return handleTeamsCallback(cb, teamsMatch[1] as "send" | "cancel", teamsMatch[2], String(cbChat));
  }

  // Attendee-reminder approval buttons.
  const attMatch = /^attrem:(go|skip):(.+)$/.exec(cb.data ?? "");
  if (attMatch) {
    return handleAttendeeReminderCallback(cb, attMatch[1] as "go" | "skip", attMatch[2], String(cbChat));
  }

  // Deadline reminder-ladder buttons.
  const dlMatch = /^dl:(all|day|no):(.+)$/.exec(cb.data ?? "");
  if (dlMatch) {
    return handleDeadlineCallback(owner, cb, dlMatch[1] as "all" | "day" | "no", dlMatch[2], String(cbChat));
  }

  // Accountability + relationship buttons: chase via Teams/email, snooze, done, dismiss.
  const loopMatch = /^loop:(teams|email|snooze|done|dismiss):(.+)$/.exec(cb.data ?? "");
  if (loopMatch) {
    return handleLoopCallback(
      owner,
      cb,
      loopMatch[1] as "teams" | "email" | "snooze" | "done" | "dismiss",
      loopMatch[2],
      String(cbChat)
    );
  }

  const match = /^task:(approve|reject|today|tmrw|date):(.+)$/.exec(cb.data ?? "");
  if (!match) {
    await answerCallbackQuery(cb.id, "Unknown action").catch(() => {});
    return NextResponse.json({ ok: true });
  }
  const [, action, taskId] = match;
  const original = cb.message?.text ?? "Task";

  // "Pick a date" → park a pending request; Dean's next reply is the deadline.
  if (action === "date") {
    await setAwaitingDeadline(taskId, original).catch(() => {});
    await answerCallbackQuery(cb.id, "Reply with the date").catch(() => {});
    if (cb.message?.message_id !== undefined) {
      await editMessageText(
        String(cbChat),
        cb.message.message_id,
        `${original}\n\n🗓 What's the deadline? Reply with a date — e.g. 2026-08-15, 25/08, or “next Friday”.`
      ).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  let deadline: string | null = null;
  let deadlineLabel = "";
  if (action === "today") {
    deadline = localDateSAST(0);
    deadlineLabel = " · deadline today";
  } else if (action === "tmrw") {
    deadline = localDateSAST(1);
    deadlineLabel = " · deadline tomorrow";
  }

  const result =
    action === "reject" ? await rejectSuggestedTask(owner, taskId) : await approveSuggestedTask(owner, taskId, deadline);

  const title = result.title ?? "task";
  let toast: string;
  let newText: string;
  if (result.ok && action === "reject") {
    toast = "Rejected";
    newText = `❌ Rejected · ${title}`;
  } else if (result.ok) {
    toast = deadline ? `Approved — deadline ${deadline}` : "Approved — sent to Todoist";
    newText = `✅ Approved${deadlineLabel} · ${title}`;
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

/** Set (or decline) the reminder ladder for a detected deadline. */
async function handleDeadlineCallback(
  owner: Owner,
  cb: { id: string; message?: { message_id?: number; text?: string } },
  action: "all" | "day" | "no",
  id: string,
  chatId: string
): Promise<NextResponse> {
  const pending = await getPendingDeadline(id);
  if (!pending) {
    await answerCallbackQuery(cb.id, "This suggestion has expired or was already handled").catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const original = cb.message?.text ?? "Deadline";
  const firstLine = `“${pending.what}” — due ${pending.dueLabel}`;
  let toast: string;
  let newText: string;

  if (action === "no") {
    await markDeadlineDone(owner, id);
    toast = "Ignored";
    newText = `✖️ Ignored · ${firstLine}`;
  } else {
    const tierText: Record<string, string> = {
      day_before: `Due tomorrow — ${pending.what} (${pending.dueLabel})`,
      on_the_day: `Due today — ${pending.what} (${pending.dueLabel})`,
      hour_before: `Due in 1 hour — ${pending.what} (${pending.dueLabel})`,
    };
    const wanted = action === "day" ? pending.rungs.filter((r) => r.tier === "on_the_day") : pending.rungs;
    let set = 0;
    for (const r of wanted) {
      const res = await createReminder(owner, tierText[r.tier] ?? pending.what, r.atIso);
      if (res.ok) set++;
    }
    await markDeadlineDone(owner, id);
    toast = set ? `Set ${set} reminder${set === 1 ? "" : "s"}` : "Nothing left to set";
    newText = `🔔 ${set} reminder${set === 1 ? "" : "s"} set · ${firstLine}`;
  }

  await answerCallbackQuery(cb.id, toast).catch(() => {});
  if (cb.message?.message_id !== undefined) {
    await editMessageText(chatId, cb.message.message_id, newText).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}

/** Chase / snooze / close an open loop from its Telegram nudge. */
async function handleLoopCallback(
  owner: Owner,
  cb: { id: string; message?: { message_id?: number; text?: string } },
  action: "teams" | "email" | "snooze" | "done" | "dismiss",
  id: string,
  chatId: string
): Promise<NextResponse> {
  const original = cb.message?.text ?? "Open loop";
  let toast: string;
  let newText: string;

  if (action === "snooze") {
    await recordSyncRun({ userId: owner.user.id, sourceSystem: `loopsnooze:${id}`, stats: {} }).catch(() => {});
    toast = "Snoozed 2 days";
    newText = `😴 Snoozed · ${original.split("\n")[0]}`;
  } else if (action === "dismiss") {
    // Relationship nudge parked — id is the person id.
    await recordSyncRun({ userId: owner.user.id, sourceSystem: `relsnooze:${id}`, stats: {} }).catch(() => {});
    toast = "Okay — parked";
    newText = `💤 Parked · ${original.split("\n")[0]}`;
  } else if (action === "done") {
    const done = await markCommitmentDone(owner.user.id, id).catch(() => null);
    toast = done ? "Marked done" : "Couldn't find it";
    newText = done ? `✅ Done · ${original.split("\n")[0]}` : original;
  } else {
    // teams | email — send the already-drafted chase (shown in the nudge).
    const chase = await getPendingChase(id);
    if (!chase) {
      await answerCallbackQuery(cb.id, "This draft has expired or was already handled").catch(() => {});
      return NextResponse.json({ ok: true });
    }
    if (action === "teams") {
      const res = await messageTeammateForUser(owner.user.id, chase.personEmail, chase.draft);
      await markChaseDone(owner, id);
      toast = res.ok ? "Sent via Teams" : res.error ?? "Teams send failed";
      newText = res.ok
        ? `📤 Chased ${chase.personName} on Teams · ${original.split("\n")[0]}`
        : `${original}\n\n⚠️ ${res.error ?? "Teams send failed"}`;
    } else {
      await stagePendingEmail({
        kind: "new",
        mailbox: chase.businessKey,
        to: [chase.personEmail],
        subject: chase.subject,
        body: chase.draft,
      });
      await markChaseDone(owner, id);
      toast = "Draft email ready — approve to send";
      newText = `✉️ Email draft ready for ${chase.personName} · ${original.split("\n")[0]}`;
    }
  }

  await answerCallbackQuery(cb.id, toast).catch(() => {});
  if (cb.message?.message_id !== undefined) {
    await editMessageText(chatId, cb.message.message_id, newText).catch(() => {});
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

/** Send or cancel a staged Teams message to a teammate when Dean taps the button. */
async function handleTeamsCallback(
  cb: { id: string; message?: { message_id?: number } },
  action: "send" | "cancel",
  id: string,
  chatId: string
): Promise<NextResponse> {
  const pending = await getPendingTeams(id);
  if (!pending) {
    await answerCallbackQuery(cb.id, "This draft has expired or was already handled").catch(() => {});
    return NextResponse.json({ ok: true });
  }
  if (action === "cancel") {
    await markPendingTeamsDone(id);
    await answerCallbackQuery(cb.id, "Cancelled").catch(() => {});
    if (cb.message?.message_id !== undefined) await editMessageText(chatId, cb.message.message_id, "❌ Teams message cancelled — not sent.").catch(() => {});
    return NextResponse.json({ ok: true });
  }
  const res = await messageTeammate(pending.email, pending.body);
  if (res.ok) {
    await markPendingTeamsDone(id);
    await answerCallbackQuery(cb.id, "Sent ✅").catch(() => {});
    if (cb.message?.message_id !== undefined) await editMessageText(chatId, cb.message.message_id, `✅ Sent to ${pending.name} on Teams`).catch(() => {});
  } else {
    await answerCallbackQuery(cb.id, `Failed: ${res.error ?? "send error"}`.slice(0, 190)).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}

/** Approve or skip reminding a meeting's attendees on Teams. */
async function handleAttendeeReminderCallback(
  cb: { id: string; message?: { message_id?: number; text?: string } },
  action: "go" | "skip",
  id: string,
  chatId: string
): Promise<NextResponse> {
  const offer = await getPendingOffer(id);
  if (!offer) {
    await answerCallbackQuery(cb.id, "This has expired or was already handled").catch(() => {});
    return NextResponse.json({ ok: true });
  }
  if (action === "skip") {
    await markOfferDone(id);
    await answerCallbackQuery(cb.id, "Skipped").catch(() => {});
    if (cb.message?.message_id !== undefined) await editMessageText(chatId, cb.message.message_id, `❌ Skipped — didn't remind attendees of “${offer.title}”.`).catch(() => {});
    return NextResponse.json({ ok: true });
  }
  const sent = await sendAttendeeReminders(offer);
  await markOfferDone(id);
  await answerCallbackQuery(cb.id, sent ? `Reminded ${sent} on Teams ✅` : "Couldn't send").catch(() => {});
  if (cb.message?.message_id !== undefined) {
    await editMessageText(chatId, cb.message.message_id, `✅ Reminded ${sent} attendee(s) of “${offer.title}” on Teams.`).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
