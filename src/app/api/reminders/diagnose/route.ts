import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { decryptSecret } from "@/lib/crypto";
import { getReminderConnection } from "@/lib/db/repo";
import { listReminderTodos } from "@/lib/reminders/caldav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * End-to-end read test: fetch the signed-in user's reminders from their chosen
 * list and report a summary. Open this while logged in to confirm the CalDAV
 * read path works against real iCloud.
 */
export async function GET() {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;

  const conn = await getReminderConnection(owner.user.id);
  if (!conn) return NextResponse.json({ ok: false, error: "Apple Reminders not connected." }, { status: 400 });
  if (!conn.list_url) return NextResponse.json({ ok: false, error: "No list chosen yet." }, { status: 400 });

  try {
    const todos = await listReminderTodos(conn.username, decryptSecret(conn.app_password_enc), conn.list_url);
    return NextResponse.json({
      ok: true,
      list: conn.list_name,
      open_count: todos.length,
      sample: todos.slice(0, 10).map((t) => ({ title: t.title, due: t.dueDate, tags: t.tags })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "read failed" },
      { status: 502 }
    );
  }
}
