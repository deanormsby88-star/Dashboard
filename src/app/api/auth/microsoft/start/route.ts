import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/current-user";
import { authorizeUrl, isGraphConfigured } from "@/lib/calendar/microsoft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Begin connecting an ADDITIONAL calendar for the logged-in user. The chosen
 *  context key must be one of the user's own contexts; the OAuth state binds
 *  the initiating user so the callback attributes the tokens correctly. */
export async function GET(request: NextRequest) {
  const owner = await getSessionUser();
  if (!owner) return NextResponse.redirect(new URL("/login", request.url));
  if (!isGraphConfigured()) {
    return NextResponse.redirect(new URL("/settings?calendar=not_configured", request.url));
  }
  const calendar = request.nextUrl.searchParams.get("calendar");
  if (!calendar || !owner.businesses.some((b) => b.key === calendar)) {
    return NextResponse.redirect(new URL("/settings?calendar=bad_request", request.url));
  }
  return NextResponse.redirect(authorizeUrl(calendar, owner.user.id));
}
