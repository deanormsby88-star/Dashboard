import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { requireSession } from "@/lib/auth/require-session";
import { ensureOwner, listPeople } from "@/lib/db/repo";
import { getMyId, getValidAccessToken, resolveTeamsUser } from "@/lib/calendar/microsoft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnose Teams access on the Heya connection: is the account connected, can
 * we read Dean's identity (basic Graph) and resolve a teammate by email
 * (User.ReadBasic.All)? Read-only — sends nothing. Open in the browser while
 * logged in.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const owner = await ensureOwner();
  const token = await getValidAccessToken(owner.user.id, "heya");
  const out: Record<string, unknown> = { heyaConnected: Boolean(token) };
  if (!token) return NextResponse.json({ ...out, verdict: "Heya isn't connected — reconnect it in Settings." });

  const myId = await getMyId(token);
  out.myId = myId ? "ok" : "FAILED (basic Graph read)";

  // Resolve a real teammate by email (tests User.ReadBasic.All / Teams scope).
  const people = await listPeople();
  const teammate = people.find((p) => p.email && /@heya\.team$/i.test(p.email)) ?? null;
  const testEmail = teammate?.email ?? getEnv().DEANOS_EMAIL;
  const resolved = await resolveTeamsUser(token, testEmail);
  out.resolveTeammate = {
    email: testEmail,
    result: resolved ? "ok" : "FAILED — likely missing Teams admin consent (reconnect Heya with 'consent on behalf of your organization').",
  };
  out.verdict =
    myId && resolved ? "Teams access looks good." : "Teams scopes not active yet — reconnect Heya Outlook with admin consent.";
  return NextResponse.json(out);
}
