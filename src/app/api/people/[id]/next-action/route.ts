import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { requireSession } from "@/lib/auth/require-session";
import { callText } from "@/lib/ai/openai";
import { ensureOwner, getPersonBundleById, insertAiRun } from "@/lib/db/repo";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * On-demand "next recommended action" for a person, composed from internal
 * context only. On-demand (not per-page-load) to avoid an OpenAI call every
 * time a profile is viewed.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const bundle = await getPersonBundleById(params.id);
  if (!bundle.person) return NextResponse.json({ error: "Person not found." }, { status: 404 });

  const context = {
    name: bundle.person.full_name,
    role: bundle.person.role,
    organization: bundle.person.organization,
    owed_to_dean: bundle.commitments.filter((c) => c.direction === "to_dean" && c.status === "open").map((c) => c.text),
    promised_by_dean: bundle.commitments.filter((c) => c.direction === "by_dean" && c.status === "open").map((c) => c.text),
    meetings: bundle.meetings.map((m) => ({ title: m.title, summary: m.summary })),
    recent_emails: bundle.emails.map((e) => ({ subject: e.subject, summary: e.summary })),
    notes: bundle.interactions.map((i) => i.summary),
  };

  const owner = await ensureOwner();
  const model = getEnv().OPENAI_MODEL_PRIORITIZER;
  const result = await callText({
    model,
    system:
      "You are DeanOS, Dean Ormsby's chief of staff. Given the internal context about one person, recommend the single most valuable next action Dean should take with them, in one or two sentences. Ground it strictly in the context; if there's nothing pressing, say so plainly. No preamble, no markdown.",
    user: JSON.stringify(context),
  });
  await insertAiRun({
    userId: owner.user.id,
    promptName: "person-next-action",
    promptVersion: "1.0.0",
    model,
    input: context,
    rawOutput: result.rawText,
    parsedOutput: null,
    status: result.ok ? "ok" : "api_failed",
    error: result.error,
    usage: result.usage,
  });
  if (!result.ok || !result.rawText) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, action: result.rawText.trim() });
}
