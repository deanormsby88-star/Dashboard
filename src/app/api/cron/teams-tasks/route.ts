import { NextResponse, type NextRequest } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { forEachUser } from "@/lib/cron/for-each-user";
import { scanTeamsForTasks } from "@/lib/teams/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Scan recent Teams messages for tasks (→ Telegram approve buttons). Auth mirrors the other crons. */
export async function GET(request: NextRequest) {
  const denied = requireCron(request);
  if (denied) return denied;
  try {
    const perUser = await forEachUser((owner) => scanTeamsForTasks(owner));
    return NextResponse.json({ ok: true, users: perUser.length, results: perUser });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
