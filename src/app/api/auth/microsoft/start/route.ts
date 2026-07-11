import { NextResponse, type NextRequest } from "next/server";
import { getSessionEmail } from "@/lib/auth/require-session";
import { authorizeUrl, isGraphConfigured } from "@/lib/calendar/microsoft";
import type { BusinessKey } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Begin the Microsoft OAuth flow for a given calendar (heya | jic). */
export async function GET(request: NextRequest) {
  const email = await getSessionEmail();
  if (!email) return NextResponse.redirect(new URL("/login", request.url));
  if (!isGraphConfigured()) {
    return NextResponse.redirect(new URL("/settings?calendar=not_configured", request.url));
  }
  const calendar = request.nextUrl.searchParams.get("calendar");
  if (!calendar || !["heya", "jic", "personal"].includes(calendar)) {
    return NextResponse.redirect(new URL("/settings?calendar=bad_request", request.url));
  }
  return NextResponse.redirect(authorizeUrl(calendar as BusinessKey));
}
