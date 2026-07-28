import { NextResponse, type NextRequest } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { generateAndStoreBrief } from "@/lib/assistant/brief";
import { pruneOldSyncRuns } from "@/lib/db/repo";
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
  const denied = requireCron(request);
  if (denied) return denied;

  try {
    const brief = await generateAndStoreBrief("cron");
    // Deliver to Telegram if the bot is connected (no-op otherwise).
    const delivered = await sendToDean(brief.content);
    // Housekeeping: keep the sync_runs KV store from growing without bound.
    await pruneOldSyncRuns().catch(() => {});
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
