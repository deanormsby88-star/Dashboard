import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { generateAndStoreBrief } from "@/lib/assistant/brief";
import { sendToDean } from "@/lib/telegram/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled daily brief. Called by Vercel Cron (see vercel.json) on a weekday
 * morning; generates the executive brief and stores it so it's waiting on the
 * Today page. Vercel Cron authenticates by sending `Authorization: Bearer
 * <CRON_SECRET>`. Also accepts the same secret as `?secret=` for manual runs.
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
    const brief = await generateAndStoreBrief("cron");
    // Deliver to Telegram if the bot is connected (no-op otherwise).
    const delivered = await sendToDean(brief.content);
    return NextResponse.json({
      ok: true,
      generatedFor: brief.generated_for,
      top3: brief.top3.length,
      telegram: delivered,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
