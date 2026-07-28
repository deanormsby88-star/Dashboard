import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { upsertBusinessContext } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  contexts: z
    .array(z.object({ key: z.string().min(1).max(40), name: z.string().min(1).max(80) }))
    .min(1)
    .max(10),
});

/** Save the user's work contexts during setup (rename defaults / add own). */
export async function POST(request: Request) {
  const owner = await requireUser();
  if (owner instanceof Response) return owner;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid contexts." }, { status: 400 });
  }
  for (const c of parsed.data.contexts) {
    await upsertBusinessContext(owner.user.id, c.key.trim().toLowerCase(), c.name.trim());
  }
  return NextResponse.json({ ok: true, count: parsed.data.contexts.length });
}
