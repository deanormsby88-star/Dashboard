import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { encryptSecret } from "@/lib/crypto";
import { upsertGarminConnection } from "@/lib/db/repo";
import { verifyGarmin } from "@/lib/garmin/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Connect Garmin: verify login, then store the credential encrypted. */
export async function POST(request: NextRequest) {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;

  const body = (await request.json().catch(() => null)) as { username?: string; password?: string } | null;
  const username = body?.username?.trim();
  const password = body?.password;
  if (!username || !password) {
    return NextResponse.json({ error: "Enter your Garmin email and password." }, { status: 400 });
  }

  try {
    await verifyGarmin(username, password);
  } catch {
    return NextResponse.json(
      { error: "Couldn't sign in to Garmin. Check the email/password. If you have two-factor on, that can block this login." },
      { status: 400 }
    );
  }

  await upsertGarminConnection({ userId: owner.user.id, username, passwordEnc: encryptSecret(password) });
  return NextResponse.json({ ok: true });
}
