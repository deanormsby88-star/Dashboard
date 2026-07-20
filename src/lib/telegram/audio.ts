/**
 * Map a Telegram audio file to a filename OpenAI's transcription endpoint will
 * accept. OpenAI validates the *extension*, not the bytes, and rejects some
 * containers Telegram uses — most importantly `.oga`, which is what every
 * Telegram voice note downloads as. Since Telegram voice notes are always
 * OGG/Opus, `.oga` is safely renamed to `.ogg` (which OpenAI accepts).
 */

/** Extensions the OpenAI transcription endpoint accepts. */
const SUPPORTED_EXT = new Set([
  "flac",
  "m4a",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "ogg",
  "wav",
  "webm",
]);

/** Pick a supported extension from the file path, falling back to the mime type. */
export function transcriptionFilename(filePath: string, mimeType?: string | null): string {
  let ext = (filePath.split(".").pop() ?? "").toLowerCase();
  // Telegram voice notes are OGG/Opus but come as `.oga`, which OpenAI rejects.
  if (ext === "oga" || ext === "opus") ext = "ogg";

  if (!SUPPORTED_EXT.has(ext)) {
    const m = (mimeType ?? "").toLowerCase();
    if (/ogg|opus/.test(m)) ext = "ogg";
    else if (/wav/.test(m)) ext = "wav";
    else if (/webm/.test(m)) ext = "webm";
    else if (/mp4|m4a|aac|x-m4a/.test(m)) ext = "m4a";
    else if (/mpeg|mp3|mpga/.test(m)) ext = "mp3";
    else if (/flac/.test(m)) ext = "flac";
    else ext = "ogg"; // sensible default — Telegram voice is OGG
  }
  return `voice.${ext}`;
}

/** Normalize the mime type so OpenAI receives a container it understands. */
export function transcriptionMimeType(mimeType?: string | null): string {
  const m = (mimeType ?? "").toLowerCase();
  // Telegram sends audio/ogg for voice notes; keep it, but map the odd ones.
  if (!m || m === "audio/oga" || /opus/.test(m)) return "audio/ogg";
  return m;
}
