import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { getRisk, updateRisk } from "@/lib/db/repo";

export const runtime = "nodejs";

const patchSchema = z.object({
  description: z.string().min(1).max(2000).optional(),
  severity: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(["open", "mitigated", "closed"]).optional(),
});

/** Edit a risk's wording/severity or change its status. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const risk = await getRisk(params.id);
  if (!risk) return NextResponse.json({ error: "Risk not found." }, { status: 404 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }

  const updated = await updateRisk(risk.id, parsed.data);
  return NextResponse.json({ ok: true, risk: updated });
}
