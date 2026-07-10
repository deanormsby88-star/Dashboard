import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { processMeeting } from "@/lib/processors/meeting";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Retry (or first-run) the Meeting Processor for a stored meeting. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const result = await processMeeting(params.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, counts: result.counts });
}
