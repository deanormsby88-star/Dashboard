import { NextResponse, type NextRequest } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { forEachUser } from "@/lib/cron/for-each-user";
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
  const denied = requireCron(request);
  if (denied) return denied;

  try {
    const perUser = await forEachUser((owner) => sendDueMeetingReminders(owner));
    return NextResponse.json({ ok: true, users: perUser.length, results: perUser });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
