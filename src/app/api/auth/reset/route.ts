import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { hashPassword } from "@/lib/auth/password";
import { peekResetUserId, verifyResetToken } from "@/lib/auth/reset";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { clientIp, isRateLimited, recordFailure, recordSuccess } from "@/lib/auth/throttle";
import { getUserById, getUserPasswordHash, setUserPasswordHash } from "@/lib/db/repo";
import { sendSecurityMessage } from "@/lib/telegram/notify";

export const runtime = "nodejs";

const bodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

/** Set a new password from a valid reset link, then sign the user in. */
export async function POST(request: NextRequest) {
  const env = getEnv();
  const ip = clientIp(request.headers);
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 }
    );
  }
  const { token, password } = parsed.data;

  const expired = () => {
    recordFailure(ip);
    return NextResponse.json(
      { error: "This reset link is invalid, expired or already used. Request a new one." },
      { status: 400 }
    );
  };

  const claimedId = peekResetUserId(token);
  const owner = claimedId ? await getUserById(claimedId).catch(() => null) : null;
  // Only the Second owner account can be reset.
  if (!owner || owner.user.email.toLowerCase() !== env.DEANOS_EMAIL.toLowerCase()) return expired();

  const currentHash = (await getUserPasswordHash(owner.user.id)) ?? env.DEANOS_PASSWORD_HASH;
  if (verifyResetToken(token, currentHash, env.SESSION_SECRET) !== owner.user.id) return expired();

  try {
    await setUserPasswordHash(owner.user.id, hashPassword(password));
  } catch {
    return NextResponse.json(
      { error: "Couldn't save the new password. The database may need migration 0014." },
      { status: 500 }
    );
  }
  recordSuccess(ip);

  await sendSecurityMessage(owner.user.id, "✅ Your Second password was just changed.").catch(() => false);

  const session = await createSessionToken(owner.user.id, owner.user.email, env.SESSION_SECRET);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_URL.startsWith("https://"),
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return response;
}
