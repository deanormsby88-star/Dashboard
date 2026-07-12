import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
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
    const result = await fireDueReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
