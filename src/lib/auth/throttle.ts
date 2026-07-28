/**
 * Best-effort in-memory login throttle. On serverless this is per-warm-instance
 * (not global), so it's defense-in-depth on top of the scrypt hash + fixed
 * email — it meaningfully slows a burst from a single instance without a
 * shared store. Keyed by client IP.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILURES = 10;

const buckets = new Map<string, Bucket>();

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/** True when this IP has exceeded the failed-login budget for the window. */
export function isRateLimited(ip: string, now: number = Date.now()): boolean {
  const b = buckets.get(ip);
  if (!b || now > b.resetAt) return false;
  return b.count >= MAX_FAILURES;
}

/** Record a failed attempt (call only on failure). */
export function recordFailure(ip: string, now: number = Date.now()): void {
  const b = buckets.get(ip);
  if (!b || now > b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  b.count += 1;
  // Opportunistic cleanup so the map can't grow without bound.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
  }
}

/** Clear on success. */
export function recordSuccess(ip: string): void {
  buckets.delete(ip);
}
