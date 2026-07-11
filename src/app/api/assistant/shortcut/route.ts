import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { transcribeAudio } from "@/lib/ai/openai";
import { runCommand } from "@/lib/assistant/commands";
import { sendToDean } from "@/lib/telegram/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Voice endpoint for the iOS Action Button (Shortcuts). Authenticated by a
 * shared secret (X-DeanOS-Secret header or ?secret=), since a shortcut can't
 * carry the login cookie.
 *
 * Accepts EITHER:
 *   - multipart/form-data with an `audio` file (recorded in the shortcut) —
 *     transcribed with OpenAI for voice-note-grade accuracy; or
 *   - JSON { "message": "..." } — pre-transcribed text (e.g. Apple Dictate).
 *
 * Runs the same agent as Telegram (channel 'telegram', shared memory),
 * mirrors the heard text + reply into the Telegram chat, and returns
 * { transcript, reply } so the shortcut can show or speak the answer.
 */
export async function POST(request: NextRequest) {
  const env = getEnv();
  const secret = env.ASSISTANT_SHORTCUT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Shortcut endpoint not configured." }, { status: 503 });
  }
  const provided =
    request.headers.get("x-deanos-secret") ?? request.nextUrl.searchParams.get("secret") ?? "";
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let text = "";
  let transcript: string | null = null;
  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("audio") ?? form.get("file");
      const typed = form.get("message");
      if (file && typeof file !== "string") {
        const bytes = await file.arrayBuffer();
        const name = "name" in file && file.name ? file.name : "audio.m4a";
        const tr = await transcribeAudio({
          bytes,
          filename: name,
          mimeType: file.type || "audio/m4a",
        });
        if (!tr.ok || !tr.text) {
          return NextResponse.json({ error: tr.error ?? "Could not transcribe audio." }, { status: 502 });
        }
        text = tr.text;
        transcript = tr.text;
      } else if (typeof typed === "string") {
        text = typed.trim();
      }
    } else {
      const body = (await request.json().catch(() => null)) as { message?: string } | null;
      text = (body?.message ?? "").trim();
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bad request." },
      { status: 400 }
    );
  }

  if (!text) {
    return NextResponse.json({ error: "No audio or message provided." }, { status: 400 });
  }

  const { reply } = await runCommand(text, "telegram");

  // Mirror into Telegram so the conversation lives there too (best-effort).
  const prefix = transcript ? `🎤 “${transcript}”\n\n` : "";
  await sendToDean(prefix + reply).catch(() => {});

  return NextResponse.json({ ok: true, transcript, reply });
}
