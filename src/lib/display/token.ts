import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Stable, long-lived read token for an external display (e.g. a SenseCraft
 * panel) to fetch the owner's dashboard JSON. HMAC of the userId with a fixed
 * prefix — no timestamp, so the token is stable and can be pasted into a device
 * once. Read-only: it only unlocks GET /api/display. Rotate SESSION_SECRET to
 * revoke all device tokens.
 */

function b64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signDisplayToken(userId: string): string {
  const body = `display.${userId}`;
  const sig = createHmac("sha256", getEnv().SESSION_SECRET).update(body).digest();
  return `${b64url(Buffer.from(body))}.${b64url(sig)}`;
}

/** Verify a display token and return the userId, or null if invalid. */
export function verifyDisplayToken(token: string): string | null {
  const [b64, sig] = (token ?? "").split(".");
  if (!b64 || !sig) return null;
  const body = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const expected = b64url(createHmac("sha256", getEnv().SESSION_SECRET).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!body.startsWith("display.")) return null;
  const userId = body.slice("display.".length);
  return userId || null;
}
