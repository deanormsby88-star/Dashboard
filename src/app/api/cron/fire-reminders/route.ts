import { NextResponse, type NextRequest } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { fireDueReminders } from "@/lib/assistant/adhoc-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Fires ad-hoc reminders Dean set via chat ("remind me to… at 3pm"). Vercel
 * Cron hits this every few minutes (see vercel.json); delivers any due,
 * undelivered reminder to Telegram. Auth mirrors the other crons.
 */
export async function GET(request: NextRequest) {
  const denied = requireCron(request);
  if (denied) return denied;

  try {
    const result = await fireDueReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
