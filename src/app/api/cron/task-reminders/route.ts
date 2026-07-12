import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { sendTaskReminders } from "@/lib/todoist/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Todoist due-task reminders. Vercel Cron hits this each morning (see
 * vercel.json); it sends Dean a Telegram digest of tasks due today or overdue,
 * once per day. Auth mirrors the other crons.
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
    const result = await sendTaskReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
