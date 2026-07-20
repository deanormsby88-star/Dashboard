import { describe, expect, it } from "vitest";
import { transcriptionFilename, transcriptionMimeType } from "@/lib/telegram/audio";

describe("transcriptionFilename", () => {
  it("maps Telegram's .oga voice notes to .ogg (OpenAI rejects .oga)", () => {
    expect(transcriptionFilename("voice/file_12.oga", "audio/ogg")).toBe("voice.ogg");
  });

  it("maps .opus to .ogg", () => {
    expect(transcriptionFilename("voice/file_12.opus", "audio/ogg")).toBe("voice.ogg");
  });

  it("keeps already-supported extensions", () => {
    expect(transcriptionFilename("audio/file_9.mp3", "audio/mpeg")).toBe("voice.mp3");
    expect(transcriptionFilename("audio/file_9.m4a", "audio/mp4")).toBe("voice.m4a");
    expect(transcriptionFilename("audio/file_9.wav", "audio/wav")).toBe("voice.wav");
  });

  it("falls back to the mime type when the extension is unknown", () => {
    expect(transcriptionFilename("voice/file_no_ext", "audio/ogg")).toBe("voice.ogg");
    expect(transcriptionFilename("voice/file.bin", "audio/mpeg")).toBe("voice.mp3");
    expect(transcriptionFilename("voice/file.bin", "audio/mp4")).toBe("voice.m4a");
  });

  it("defaults to ogg (Telegram voice) when nothing is recognizable", () => {
    expect(transcriptionFilename("voice/file.bin", null)).toBe("voice.ogg");
    expect(transcriptionFilename("voice/file.bin", "application/octet-stream")).toBe("voice.ogg");
  });
});

describe("transcriptionMimeType", () => {
  it("normalizes opus/oga variants to audio/ogg", () => {
    expect(transcriptionMimeType("audio/oga")).toBe("audio/ogg");
    expect(transcriptionMimeType("audio/opus")).toBe("audio/ogg");
    expect(transcriptionMimeType(null)).toBe("audio/ogg");
  });

  it("passes through recognized mime types", () => {
    expect(transcriptionMimeType("audio/ogg")).toBe("audio/ogg");
    expect(transcriptionMimeType("audio/mpeg")).toBe("audio/mpeg");
  });
});
