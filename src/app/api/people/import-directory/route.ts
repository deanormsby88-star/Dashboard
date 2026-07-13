import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { ensureOwner, getOrCreatePersonByName, updatePerson } from "@/lib/db/repo";
import { HEYA_DIRECTORY } from "@/lib/people/directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click import/refresh of the Heya team directory. Upserts each person by
 * name (fills role, organization, email, notes). Safe to re-run.
 */
export async function POST() {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const owner = await ensureOwner();

  let updated = 0;
  for (const entry of HEYA_DIRECTORY) {
    const person = await getOrCreatePersonByName(owner.user.id, entry.fullName);
    await updatePerson(person.id, {
      role: entry.role,
      organization: "Heya",
      email: entry.email,
      notes: entry.notes,
    });
    updated++;
  }
  return NextResponse.json({ ok: true, updated });
}
