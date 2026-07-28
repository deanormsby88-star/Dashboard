import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { signLinkCode } from "@/lib/telegram/link";
import { getBotUsername } from "@/lib/telegram/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Return a personal Telegram deep link that links this user's chat on tap. */
export async function GET() {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;

  const username = await getBotUsername();
  if (!username) {
    return NextResponse.json({ error: "Telegram bot isn't configured yet." }, { status: 503 });
  }
  const code = signLinkCode(owner.user.id);
  return NextResponse.json({
    ok: true,
    url: `https://t.me/${username}?start=${code}`,
    linked: Boolean(owner.user.telegram_chat_id),
  });
}
