import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { createResetToken } from "@/lib/auth/reset";
import { clientIp, isRateLimited, recordFailure } from "@/lib/auth/throttle";
import { ensureOwner, getUserPasswordHash } from "@/lib/db/repo";
import { sendSecurityMessage } from "@/lib/telegram/notify";

export const runtime = "nodejs";

const bodySchema = z.object({ email: z.string().email() });

// Same reply whether or not the email matched, so this can't be used to
// discover the account email.
const GENERIC = {
  ok: true,
  message: "If that's your Second email, a reset link is on its way to your Telegram.",
};

/** Send a password-reset link to the owner's linked Telegram chat. */
export async function POST(request: NextRequest) {
  const env = getEnv();
  const ip = clientIp(request.headers);
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }
  // Every request counts toward the budget so the Telegram chat can't be spammed.
  recordFailure(ip);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your email address." }, { status: 400 });
  }
  if (parsed.data.email.trim().toLowerCase() !== env.DEANOS_EMAIL.toLowerCase()) {
    return NextResponse.json(GENERIC);
  }

  const owner = await ensureOwner();
  const currentHash = (await getUserPasswordHash(owner.user.id)) ?? env.DEANOS_PASSWORD_HASH;
  const token = createResetToken(owner.user.id, currentHash, env.SESSION_SECRET);
  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;

  await sendSecurityMessage(
    owner.user.id,
    `🔑 Second password reset\n\nTap to choose a new password (link expires in 30 minutes):\n${link}\n\nIf you didn't ask for this, ignore this message.`
  ).catch(() => false);

  return NextResponse.json(GENERIC);
}
