import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { listAllTasks, zohoConfigured } from "@/lib/zoho/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Live (uncached) end-to-end read test against Zoho Connect. */
export async function GET() {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;

  if (!zohoConfigured()) {
    return NextResponse.json({ ok: false, error: "Zoho env vars not set (ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN/SCOPE_ID)." }, { status: 400 });
  }
  try {
    const tasks = await listAllTasks();
    const byBoard = new Map<string, number>();
    for (const t of tasks) byBoard.set(t.boardName, (byBoard.get(t.boardName) ?? 0) + 1);
    return NextResponse.json({
      ok: true,
      total: tasks.length,
      by_board: Object.fromEntries(byBoard),
      sample: tasks.slice(0, 8).map((t) => ({
        title: t.title,
        status: t.statusName,
        due: t.dueDate,
        overdue: t.isOverdue,
        assignees: t.assignees.map((a) => a.name),
        board: t.boardName,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "read failed" }, { status: 502 });
  }
}
