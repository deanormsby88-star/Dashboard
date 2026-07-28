import { NextResponse, type NextRequest } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { runWatch } from "@/lib/assistant/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Proactive watch loop. Vercel Cron hits this hourly during work hours (see
 * vercel.json). It scans for things that genuinely need Dean now and pings
 * Telegram only when warranted — staying silent otherwise. Auth mirrors the
 * other crons: `Authorization: Bearer <CRON_SECRET>` or `?secret=`.
 */
export async function GET(request: NextRequest) {
  const denied = requireCron(request);
  if (denied) return denied;

  try {
    const result = await runWatch();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
