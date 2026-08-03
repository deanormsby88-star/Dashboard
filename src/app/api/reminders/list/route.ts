import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { getReminderConnection, setReminderList } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Save the single Reminders list DeanOS should read from / write to. */
export async function POST(request: NextRequest) {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;

  const conn = await getReminderConnection(owner.user.id);
  if (!conn) return NextResponse.json({ error: "Connect Apple Reminders first." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { url?: string; name?: string } | null;
  const url = body?.url?.trim();
  if (!url) return NextResponse.json({ error: "Pick a list." }, { status: 400 });

  await setReminderList(owner.user.id, url, body?.name?.trim() || "Reminders");
  return NextResponse.json({ ok: true });
}
