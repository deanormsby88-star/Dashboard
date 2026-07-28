import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { generateAndStoreBrief } from "@/lib/assistant/brief";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Manual "refresh brief now" from the Today dashboard. */
export async function POST() {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;

  try {
    const brief = await generateAndStoreBrief(owner.user.id, "manual");
    return NextResponse.json({ ok: true, generatedFor: brief.generated_for });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
