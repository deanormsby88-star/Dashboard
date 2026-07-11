import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getPerson } from "@/lib/db/repo";
import { personResearchQuery, research } from "@/lib/research";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * On-demand public research on a person. Sends only public identifiers
 * (name, role, organisation) to web search — never internal notes.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const person = await getPerson(params.id);
  if (!person) return NextResponse.json({ error: "Person not found." }, { status: 404 });

  const query = personResearchQuery(person.full_name, person.role, person.organization);
  const result = await research(query, "person");
  if (!result.ok) return NextResponse.json({ error: result.text }, { status: 502 });
  return NextResponse.json({ ok: true, research: result.text });
}
