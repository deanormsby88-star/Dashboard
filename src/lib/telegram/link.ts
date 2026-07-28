import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Telegram account-linking codes. A user opens `https://t.me/<bot>?start=<code>`
 * from the app; Telegram sends the bot `/start <code>`; the webhook verifies the
 * code and binds that chat to the user. The code is an HMAC-signed userId +
 * timestamp (no DB round-trip needed to issue it), valid for a generous window.
 */

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function b64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signLinkCode(userId: string): string {
  const body = `${userId}.${Date.now()}`;
  const sig = createHmac("sha256", getEnv().SESSION_SECRET).update(body).digest();
  return `${b64url(Buffer.from(body))}.${b64url(sig)}`;
}

/** Verify a `/start` code and return the userId, or null if invalid/expired. */
export function verifyLinkCode(code: string): string | null {
  const [b64, sig] = code.split(".");
  if (!b64 || !sig) return null;
  const body = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const expected = b64url(createHmac("sha256", getEnv().SESSION_SECRET).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const dot = body.lastIndexOf(".");
  const userId = body.slice(0, dot);
  const ts = Number(body.slice(dot + 1));
  if (!userId || !Number.isFinite(ts) || Date.now() - ts > MAX_AGE_MS) return null;
  return userId;
}
