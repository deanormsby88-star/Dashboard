import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { runCommand } from "@/lib/assistant/commands";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
});

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }

  try {
    const result = await runCommand(parsed.data.message, "web");
    return NextResponse.json({ reply: result.reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
