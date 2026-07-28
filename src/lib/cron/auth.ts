import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Authorize a cron/scheduled request. Fails CLOSED: if CRON_SECRET is not
 * configured, every call is rejected rather than run open to the internet.
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; a `?secret=` query
 * param is also accepted for manual runs.
 *
 * Returns a NextResponse to send back when unauthorized, or null when allowed.
 */
export function requireCron(request: NextRequest): NextResponse | null {
  const secret = getEnv().CRON_SECRET;
  if (!secret) {
    // No secret set → these endpoints must not be reachable at all.
    return NextResponse.json({ error: "Cron endpoint not configured." }, { status: 503 });
  }
  const auth = request.headers.get("authorization");
  const fromQuery = request.nextUrl.searchParams.get("secret");
  const provided = auth?.replace(/^Bearer\s+/i, "") ?? fromQuery ?? "";

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
