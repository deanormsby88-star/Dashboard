import { createHash, timingSafeEqual } from "node:crypto";

export const SECRET_HEADER = "x-deanos-secret";
export const IDEMPOTENCY_HEADER = "x-idempotency-key";
export const TIMESTAMP_HEADER = "x-deanos-timestamp";

/** Constant-time shared-secret comparison. */
export function verifySharedSecret(provided: string | null, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Replay protection: if the sender includes a timestamp header (epoch seconds
 * or ISO-8601), it must be within the tolerance window. Zapier steps can't
 * sign requests, so a stale-timestamp check plus idempotency keys is the
 * practical ceiling here — see SECURITY.md.
 */
export function isTimestampFresh(
  header: string | null,
  nowMs: number = Date.now(),
  toleranceMs: number = 5 * 60 * 1000
): boolean {
  if (!header) return true; // header optional; idempotency still applies
  let ts: number;
  if (/^\d+$/.test(header)) {
    ts = Number(header) * (header.length > 11 ? 1 : 1000); // seconds vs ms
  } else {
    ts = Date.parse(header);
  }
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowMs - ts) <= toleranceMs;
}

/**
 * Idempotency key: explicit header wins; otherwise derived deterministically
 * from the endpoint and raw body, so an identical replayed payload always
 * collides with the original event.
 */
export function deriveIdempotencyKey(
  endpoint: string,
  headerKey: string | null,
  rawBody: string
): string {
  if (headerKey && headerKey.trim().length > 0) {
    return `${endpoint}:${headerKey.trim()}`;
  }
  const hash = createHash("sha256").update(endpoint).update("\n").update(rawBody).digest("hex");
  return `${endpoint}:sha256:${hash}`;
}
