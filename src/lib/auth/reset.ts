import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless password-reset tokens: base64url(payload-json) + "." + HMAC.
 *
 * The payload carries a fingerprint of the password hash in force when the
 * link was issued, so the link stops working as soon as the password changes
 * (single-use) — no tokens table needed.
 */

export const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface ResetPayload {
  uid: string;
  exp: number; // epoch ms
  v: string; // fingerprint of the current password hash
}

export function passwordFingerprint(currentHash: string | null | undefined): string {
  return createHash("sha256").update(currentHash ?? "").digest("base64url").slice(0, 16);
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", `password-reset:${secret}`).update(body).digest("base64url");
}

export function createResetToken(
  userId: string,
  currentHash: string | null | undefined,
  secret: string,
  now: number = Date.now()
): string {
  const payload: ResetPayload = { uid: userId, exp: now + RESET_TTL_MS, v: passwordFingerprint(currentHash) };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Read a token's user id without trusting it (to look up the current hash). */
export function peekResetUserId(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")) as ResetPayload;
    return typeof payload.uid === "string" ? payload.uid : null;
  } catch {
    return null;
  }
}

/** Returns the user id if the token is authentic, unexpired and still matches the current password. */
export function verifyResetToken(
  token: string,
  currentHash: string | null | undefined,
  secret: string,
  now: number = Date.now()
): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(body, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ResetPayload;
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < now) return null;
    if (payload.v !== passwordFingerprint(currentHash)) return null;
    return payload.uid;
  } catch {
    return null;
  }
}
