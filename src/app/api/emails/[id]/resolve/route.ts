import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { getEmail, markEmailResolved } from "@/lib/db/repo";

export const runtime = "nodejs";

const bodySchema = z.object({ resolved: z.boolean().default(true) });

/** Mark an inbox item handled (or reopen it). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const email = await getEmail(params.id);
  if (!email) return NextResponse.json({ error: "Email not found." }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const resolved = parsed.success ? parsed.data.resolved : true;
  await markEmailResolved(email.id, resolved);
  return NextResponse.json({ ok: true, resolved });
}
