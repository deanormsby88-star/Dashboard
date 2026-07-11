import { describe, expect, it } from "vitest";
import { chunkMessage } from "@/lib/telegram/api";

describe("chunkMessage", () => {
  it("returns a single chunk when under the limit", () => {
    expect(chunkMessage("hello")).toEqual(["hello"]);
  });

  it("splits on line boundaries and keeps every chunk within the limit", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i} ${"x".repeat(20)}`);
    const chunks = chunkMessage(lines.join("\n"), 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
    // No content lost.
    expect(chunks.join("\n").replace(/\n/g, "")).toBe(lines.join("\n").replace(/\n/g, ""));
  });

  it("hard-splits a single over-long line", () => {
    const chunks = chunkMessage("y".repeat(500), 200);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(chunks.join("")).toBe("y".repeat(500));
  });
});
