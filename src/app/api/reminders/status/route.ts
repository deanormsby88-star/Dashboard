import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { getReminderConnection } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current Apple Reminders connection state for the signed-in user. */
export async function GET() {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;
  const conn = await getReminderConnection(owner.user.id);
  return NextResponse.json({
    connected: Boolean(conn),
    username: conn?.username ?? null,
    listName: conn?.list_name ?? null,
    hasList: Boolean(conn?.list_url),
  });
}
