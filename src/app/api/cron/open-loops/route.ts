import { NextResponse, type NextRequest } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { forEachUser } from "@/lib/cron/for-each-user";
import { scanOpenLoops } from "@/lib/accountability/loops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Accountability engine: nudge on open loops that have gone stale. */
export async function GET(request: NextRequest) {
  const denied = requireCron(request);
  if (denied) return denied;
  try {
    const perUser = await forEachUser((owner) => scanOpenLoops(owner));
    return NextResponse.json({ ok: true, users: perUser.length, results: perUser });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
