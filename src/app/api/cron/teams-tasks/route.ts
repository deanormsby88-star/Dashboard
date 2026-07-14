import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { scanTeamsForTasks } from "@/lib/teams/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Scan recent Teams messages for tasks (→ Telegram approve buttons). Auth mirrors the other crons. */
export async function GET(request: NextRequest) {
  const env = getEnv();
  if (env.CRON_SECRET) {
    const auth = request.headers.get("authorization");
    const fromQuery = request.nextUrl.searchParams.get("secret");
    const provided = auth?.replace(/^Bearer\s+/i, "") ?? fromQuery ?? "";
    if (provided !== env.CRON_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await scanTeamsForTasks();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
