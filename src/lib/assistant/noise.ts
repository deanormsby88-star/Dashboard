/**
 * Noise suppression for proactive nudges (watch loop) and email processing.
 *
 * Two categories are NEVER worth interrupting Dean with, and must never become
 * tasks, risks, or watch pings:
 *
 *  1. Consumer-platform login / security spam — Facebook, Instagram, Meta,
 *     WhatsApp codes, etc. Dean's words: "never raise Facebook issues, they
 *     are rubbish." These are automated, endless, and not actionable by him.
 *
 *  2. DeanOS's OWN infrastructure alerts — Supabase, Row-Level Security,
 *     Vercel, the database. Dean is non-technical; the operating system's
 *     plumbing is Claude's responsibility, not something to nag Dean about.
 */

/** Consumer social / identity platforms whose automated mail is pure noise. */
const CONSUMER_PLATFORM = /\b(facebook|fb|instagram|\bmeta\b|messenger|threads|whatsapp|tiktok|snapchat|twitter|linkedin)\b/i;

/** Sender domains for that same consumer-platform noise. */
const CONSUMER_SENDER = /@(?:[\w.-]*\.)?(facebook|facebookmail|instagram|meta|fb|tiktok|twitter|x|snapchat|linkedin)\.[a-z.]+/i;

/** DeanOS's own infrastructure — Claude handles this, Dean is never nudged. */
const INFRA = /\b(supabase|row[-\s]?level security|\brls\b|vercel|postgres(?:ql)?|deanos project|database is (?:off|exposed))\b/i;

/**
 * True when a watch signal's text is something Dean should never be pinged
 * about — consumer-platform noise or DeanOS's own infrastructure.
 */
export function isNoiseSignal(text: string): boolean {
  return CONSUMER_PLATFORM.test(text) || INFRA.test(text);
}

/**
 * True when an inbound email is consumer-platform login/security spam that
 * must be classified "ignore" and never turned into a task.
 */
export function isNoiseEmail(sender: string, subject: string, body = ""): boolean {
  if (CONSUMER_SENDER.test(sender)) return true;
  // Named platform + classic login/security-alert phrasing anywhere in the mail.
  const hay = `${subject}\n${body}`;
  const loginish =
    /\b(log ?in|login|log-in|sign ?in|new device|unrecognized|unusual (?:login|activity)|was this you|confirm it'?s you|security code|verification code|verify your account|login alert|new login)\b/i;
  return CONSUMER_PLATFORM.test(`${sender} ${subject}`) && loginish.test(hay);
}
