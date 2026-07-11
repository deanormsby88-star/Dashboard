import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { sendDueMeetingReminders } from "@/lib/calendar/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Meeting reminders. Vercel Cron hits this frequently (see vercel.json); it
 * nudges Dean on Telegram ~30 min before each real meeting, with a Waze link.
 * Auth mirrors the daily-brief cron: `Authorization: Bearer <CRON_SECRET>` or
 * `?secret=` for manual runs.
 */
export async function GET(request: NextRequest) {
  const env = getEnv();
  if (env.CRON_SECRET) {
    const auth = request.headers.get("authorization");
    const fromQuery = request.nextUrl.searchParams.get("secret");
    const provided = auth?.replace(/^Bearer\s+/i, "") ?? fromQuery ?? "";
    if (provided !== env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await sendDueMeetingReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
