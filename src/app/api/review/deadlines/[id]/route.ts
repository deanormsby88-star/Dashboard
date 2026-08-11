import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { applyDeadlineDecision } from "@/lib/deadlines/scan";

export const runtime = "nodejs";

/** Act on a deadline suggestion from the /review page: set its reminders, or ignore it. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;

  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action;
  if (action !== "all" && action !== "day" && action !== "no") {
    return NextResponse.json({ error: "action must be 'all', 'day' or 'no'" }, { status: 400 });
  }

  const result = await applyDeadlineDecision(owner, params.id, action);
  if (!result.ok) return NextResponse.json({ error: "Expired or already handled." }, { status: 404 });
  return NextResponse.json({ ok: true, set: result.set });
}
