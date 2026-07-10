import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { processEmail } from "@/lib/processors/email";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Retry the Email Processor for a stored email. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const result = await processEmail(params.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, classification: result.classification, counts: result.counts });
}
