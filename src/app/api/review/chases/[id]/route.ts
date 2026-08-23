import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { resolvePendingChase } from "@/lib/accountability/chase";

export const runtime = "nodejs";

/** Act on a drafted chase/check-in from the /review page: send it, or ignore it. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;

  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action;
  if (action !== "teams" && action !== "email" && action !== "ignore" && action !== "done") {
    return NextResponse.json({ error: "action must be 'teams', 'email', 'ignore' or 'done'" }, { status: 400 });
  }

  const result = await resolvePendingChase(owner, params.id, action);
  if (!result.chase) return NextResponse.json({ error: "Expired or already handled." }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.error ?? "Send failed" }, { status: 502 });
  return NextResponse.json({ ok: true });
}
