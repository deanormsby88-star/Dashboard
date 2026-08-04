import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { decryptSecret } from "@/lib/crypto";
import { getGarminConnection } from "@/lib/db/repo";
import { garminSnapshot } from "@/lib/garmin/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** End-to-end read test: pull the signed-in user's Garmin health snapshot. */
export async function GET() {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;

  const conn = await getGarminConnection(owner.user.id);
  if (!conn) return NextResponse.json({ ok: false, error: "Garmin not connected." }, { status: 400 });

  try {
    const snap = await garminSnapshot(conn.username, decryptSecret(conn.password_enc));
    return NextResponse.json({ ok: true, ...snap });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "read failed" }, { status: 502 });
  }
}
