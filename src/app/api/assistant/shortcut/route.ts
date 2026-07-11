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
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  async function transcribe(bytes: ArrayBuffer, filename: string, mime: string): Promise<string | null> {
    if (bytes.byteLength === 0) return null;
    const tr = await transcribeAudio({ bytes, filename, mimeType: mime });
    return tr.ok ? (tr.text ?? "") : null;
  }

  function extFor(mime: string): string {
    if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
    if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
    if (mime.includes("wav")) return "wav";
    if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
    if (mime.includes("webm")) return "webm";
    return "m4a";
  }

  try {
    if (contentType.includes("multipart/form-data")) {
      // Form body with a file field (audio/file) and/or a text field (message).
      const form = await request.formData();
      const file = form.get("audio") ?? form.get("file");
      const typed = form.get("message");
      if (file && typeof file !== "string") {
        const mime = file.type || "audio/m4a";
        transcript = await transcribe(await file.arrayBuffer(), "audio." + extFor(mime), mime);
      } else if (typeof typed === "string") {
        text = typed.trim();
      }
    } else if (contentType.includes("application/json") || contentType.includes("text/")) {
      const body = (await request.json().catch(() => null)) as { message?: string } | null;
      text = (body?.message ?? "").trim();
    } else {
      // Raw file body (Shortcuts "Request Body: File") — treat as audio.
      const mime = contentType || "audio/m4a";
      transcript = await transcribe(await request.arrayBuffer(), "audio." + extFor(mime), mime);
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bad request." },
      { status: 400 }
    );
  }

  if (transcript !== null) text = transcript;
  if (!text) {
    return NextResponse.json(
      { error: "No usable audio or message. Send a recorded audio file, or JSON {\"message\":\"…\"}." },
      { status: 400 }
    );
  }

  const { reply } = await runCommand(text, "telegram");

  // Mirror into Telegram so the conversation lives there too (best-effort).
  const prefix = transcript ? `🎤 “${transcript}”\n\n` : "";
  await sendToDean(prefix + reply).catch(() => {});

  return NextResponse.json({ ok: true, transcript, reply });
}
