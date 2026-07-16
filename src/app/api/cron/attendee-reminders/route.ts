import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { offerAttendeeReminders } from "@/lib/teams/attendee-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Offer to remind meeting attendees on Teams. Auth mirrors the other crons. */
export async function GET(request: NextRequest) {
  const env = getEnv();
  if (env.CRON_SECRET) {
    const auth = request.headers.get("authorization");
    const fromQuery = request.nextUrl.searchParams.get("secret");
    const provided = auth?.replace(/^Bearer\s+/i, "") ?? fromQuery ?? "";
    if (provided !== env.CRON_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await offerAttendeeReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
