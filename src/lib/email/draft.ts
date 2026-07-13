import { getEnv } from "@/lib/env";
import { callText } from "@/lib/ai/openai";
import { DEAN_VOICE } from "@/lib/voice";
import type { Email } from "@/lib/types";

/** Pull the bare address out of a "Name <addr@x>" sender string. */
export function senderAddress(sender: string): string {
  const m = sender.match(/<([^>]+)>/);
  return (m ? m[1] : sender).trim();
}

/** One-tap reply: opens Dean's mail app with recipient, subject and body pre-filled. */
export function mailtoLink(to: string, subject: string, body: string): string {
  const subj = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
}

const DRAFT_SYSTEM = `You draft email replies for Dean Ormsby.

${DEAN_VOICE}

Return ONLY the reply body text — no subject line, no "Here's a draft" preamble, no surrounding quotes. Do not invent facts, figures, dates, or commitments that aren't supported by the incoming email or Dean's instruction; if something needs a detail Dean hasn't given, leave a clearly-marked placeholder like [confirm date].`;

/**
 * Draft a reply to an inbound email in Dean's voice. Optional `guidance` is
 * Dean's steer for this reply ("say yes but push the meeting to next week").
 * Returns null if the model call fails.
 */
export async function draftReply(email: Email, guidance?: string): Promise<string | null> {
  const model = getEnv().OPENAI_MODEL_PRIORITIZER;
  const user = `Draft Dean's reply to this email.

From: ${email.sender}
Subject: ${email.subject}
Body:
${email.body_text.slice(0, 4000)}${guidance ? `\n\nDean's instruction for the reply: ${guidance}` : ""}`;
  const res = await callText({ model, system: DRAFT_SYSTEM, user, maxOutputTokens: 700 });
  return res.ok ? (res.rawText?.trim() ?? null) : null;
}
