import { describe, it, expect } from "vitest";
import { reminderLadder, shiftYMD, deadlineLabel } from "@/lib/deadlines/ladder";

// SAST = UTC+2. 08:00 SAST = 06:00Z, 17:00 SAST = 15:00Z.

describe("shiftYMD", () => {
  it("moves across month boundaries safely", () => {
    expect(shiftYMD("2026-08-01", -1)).toBe("2026-07-31");
    expect(shiftYMD("2026-07-31", 1)).toBe("2026-08-01");
  });
});

describe("reminderLadder — timed deadline", () => {
  // Deadline: Fri 7 Aug 2026, 15:00 SAST. "Now" a week earlier.
  const now = new Date("2026-07-31T06:00:00Z");
  const rungs = reminderLadder("2026-08-07", "15:00", now);

  it("produces all three rungs", () => {
    expect(rungs.map((r) => r.tier)).toEqual(["day_before", "on_the_day", "hour_before"]);
  });
  it("day before is 17:00 SAST the prior day (Thu 6 Aug 15:00Z)", () => {
    expect(rungs[0].atIso).toBe("2026-08-06T15:00:00.000Z");
  });
  it("on the day is 08:00 SAST (06:00Z)", () => {
    expect(rungs[1].atIso).toBe("2026-08-07T06:00:00.000Z");
  });
  it("hour before is 14:00 SAST (12:00Z)", () => {
    expect(rungs[2].atIso).toBe("2026-08-07T12:00:00.000Z");
  });
});

describe("reminderLadder — date-only deadline", () => {
  const now = new Date("2026-07-31T06:00:00Z");
  const rungs = reminderLadder("2026-08-07", null, now);

  it("has no hour-before rung", () => {
    expect(rungs.map((r) => r.tier)).toEqual(["day_before", "on_the_day"]);
  });
});

describe("reminderLadder — past rungs are dropped", () => {
  it("drops the day-before once it's passed", () => {
    // Now = the due day at 07:00 SAST (05:00Z); day-before already gone.
    const now = new Date("2026-08-07T05:00:00Z");
    const rungs = reminderLadder("2026-08-07", "15:00", now);
    expect(rungs.map((r) => r.tier)).toEqual(["on_the_day", "hour_before"]);
  });

  it("returns nothing once the deadline has passed", () => {
    const now = new Date("2026-08-07T13:30:00Z"); // 15:30 SAST, after 15:00
    expect(reminderLadder("2026-08-07", "15:00", now)).toEqual([]);
  });

  it("drops on-the-day (08:00) when the deadline is earlier that morning", () => {
    const now = new Date("2026-08-06T06:00:00Z"); // day before
    const rungs = reminderLadder("2026-08-07", "07:00", now); // due 07:00 SAST
    // 08:00 on-the-day is after the 07:00 deadline → dropped; hour-before (06:00 SAST) kept.
    expect(rungs.map((r) => r.tier)).toEqual(["day_before", "hour_before"]);
  });
});

describe("deadlineLabel", () => {
  it("includes the time when given", () => {
    expect(deadlineLabel("2026-08-07", "15:00")).toMatch(/15:00/);
  });
  it("omits time for a date-only deadline", () => {
    expect(deadlineLabel("2026-08-07", null)).not.toMatch(/\d\d:\d\d/);
  });
});
