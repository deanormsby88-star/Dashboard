import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { getEmail, markEmailResolved, rejectSuggestedTasksForSource } from "@/lib/db/repo";

export const runtime = "nodejs";

const bodySchema = z.object({ resolved: z.boolean().default(true) });

/**
 * Mark an inbox item handled (or reopen it). Handling is permanent in
 * effect: any still-suggested tasks from this email are rejected, and
 * because rejected titles stay in the dedup set, near-identical
 * suggestions from follow-up emails will not resurface.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const email = await getEmail(params.id);
  if (!email) return NextResponse.json({ error: "Email not found." }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const resolved = parsed.success ? parsed.data.resolved : true;
  await markEmailResolved(email.id, resolved);

  let rejectedTasks = 0;
  if (resolved) {
    rejectedTasks = await rejectSuggestedTasksForSource(
      email.user_id,
      email.message_id,
      "Email marked handled."
    );
  }
  return NextResponse.json({ ok: true, resolved, rejectedTasks });
}
