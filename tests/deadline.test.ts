import { describe, expect, it } from "vitest";
import { localDateSAST, resolveDeadlineDate } from "@/lib/tasks/deadline";

// Fixed reference: 2026-07-21 10:00 UTC → 12:00 SAST, still the 21st locally.
const NOW = new Date("2026-07-21T10:00:00Z");

describe("localDateSAST", () => {
  it("returns today's and tomorrow's SAST calendar date", () => {
    expect(localDateSAST(0, NOW)).toBe("2026-07-21");
    expect(localDateSAST(1, NOW)).toBe("2026-07-22");
  });

  it("rolls the date forward late in the SAST day", () => {
    // 23:30 UTC = 01:30 SAST the next day.
    const lateNight = new Date("2026-07-21T23:30:00Z");
    expect(localDateSAST(0, lateNight)).toBe("2026-07-22");
  });
});

describe("resolveDeadlineDate (deterministic paths — no model call)", () => {
  it("passes through ISO dates", async () => {
    expect(await resolveDeadlineDate("2026-08-15", NOW)).toBe("2026-08-15");
  });

  it("parses day-first DD/MM/YYYY and DD-MM-YY", async () => {
    expect(await resolveDeadlineDate("25/08/2026", NOW)).toBe("2026-08-25");
    expect(await resolveDeadlineDate("5-9-26", NOW)).toBe("2026-09-05");
  });

  it("handles today / tomorrow", async () => {
    expect(await resolveDeadlineDate("today", NOW)).toBe("2026-07-21");
    expect(await resolveDeadlineDate("Tomorrow", NOW)).toBe("2026-07-22");
  });

  it("returns null for empty or obviously non-date long text", async () => {
    expect(await resolveDeadlineDate("", NOW)).toBeNull();
    expect(
      await resolveDeadlineDate("actually never mind, can you check my calendar instead please", NOW)
    ).toBeNull();
  });
});
