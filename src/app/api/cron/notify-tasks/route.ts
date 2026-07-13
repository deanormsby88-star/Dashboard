import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
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
    const result = await notifyPendingTasks();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
