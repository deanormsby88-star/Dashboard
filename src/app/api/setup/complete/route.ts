import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { markSetupComplete } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mark the first-run setup wizard complete for the current user. */
export async function POST() {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;
  await markSetupComplete(owner.user.id);
  return NextResponse.json({ ok: true });
}
