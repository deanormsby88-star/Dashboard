import { NextResponse, type NextRequest } from "next/server";
import { isGraphConfigured, loginUrl } from "@/lib/calendar/microsoft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Begin "Sign in with Microsoft". Public — this is the login entry point. */
export async function GET(request: NextRequest) {
  if (!isGraphConfigured()) {
    return NextResponse.redirect(new URL("/login?error=not_configured", request.url));
  }
  return NextResponse.redirect(loginUrl());
}
