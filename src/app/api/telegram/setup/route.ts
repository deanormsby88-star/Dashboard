import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { requireSession } from "@/lib/auth/require-session";
import { getMe, getWebhookInfo, isTelegramConfigured, setWebhook } from "@/lib/telegram/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Report current bot + webhook status. */
export async function GET() {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ configured: false, reason: "TELEGRAM_BOT_TOKEN not set." });
  }
  const [me, info] = await Promise.all([getMe(), getWebhookInfo()]);
  return NextResponse.json({
    configured: isTelegramConfigured(),
    bot: me.ok ? me.result : { error: me.error },
    webhook: info.ok ? info.result : { error: info.error },
  });
}

/** Register (or re-register) the webhook with Telegram. */
export async function POST() {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET first." },
      { status: 400 }
    );
  }
  const url = `${env.APP_URL}/api/webhooks/telegram`;
  const result = await setWebhook(url, env.TELEGRAM_WEBHOOK_SECRET);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, webhookUrl: url });
}
