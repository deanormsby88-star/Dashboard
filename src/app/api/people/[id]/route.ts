import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { deletePerson, getPerson, updatePerson } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  role: z.string().trim().max(200).nullable().optional(),
  organization: z.string().trim().max(200).nullable().optional(),
  email: z.string().trim().max(320).nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

/** Edit a person's profile fields. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const person = await getPerson(params.id);
  if (!person) return NextResponse.json({ error: "Person not found." }, { status: 404 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid fields." }, { status: 400 });

  // Normalise empty strings to null so clearing a field wipes it.
  const norm = (v: string | null | undefined) => (v === undefined ? undefined : v && v.length ? v : null);
  const updated = await updatePerson(params.id, {
    fullName: parsed.data.fullName,
    role: norm(parsed.data.role),
    organization: norm(parsed.data.organization),
    email: norm(parsed.data.email),
    phone: norm(parsed.data.phone),
    notes: norm(parsed.data.notes),
  });
  return NextResponse.json({ ok: true, person: updated });
}

/** Remove a person. Their commitments/history are kept (person_id set null). */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const ok = await deletePerson(params.id);
  if (!ok) return NextResponse.json({ error: "Person not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
