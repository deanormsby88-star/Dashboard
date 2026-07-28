import { NextResponse, type NextRequest } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { forEachUser } from "@/lib/cron/for-each-user";
import { notifyPendingTasks } from "@/lib/tasks/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Push newly-suggested tasks to Telegram with Approve/Reject buttons. Vercel
 * Cron hits this every few minutes (see vercel.json). Auth mirrors the other
 * crons.
 */
export async function GET(request: NextRequest) {
  const denied = requireCron(request);
  if (denied) return denied;

  try {
    const perUser = await forEachUser((owner) => notifyPendingTasks(owner));
    return NextResponse.json({ ok: true, users: perUser.length, results: perUser });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
