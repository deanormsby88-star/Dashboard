import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { getGarminConnection } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;
  const conn = await getGarminConnection(owner.user.id);
  return NextResponse.json({ connected: Boolean(conn), username: conn?.username ?? null });
}
