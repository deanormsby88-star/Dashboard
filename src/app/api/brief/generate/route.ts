import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { generateAndStoreBrief } from "@/lib/assistant/brief";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Manual "refresh brief now" from the Today dashboard. */
export async function POST() {
  const session = await requireSession();
  if (session instanceof Response) return session;

  try {
    const brief = await generateAndStoreBrief("manual");
    return NextResponse.json({ ok: true, generatedFor: brief.generated_for });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
