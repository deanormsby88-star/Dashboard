import { describe, it, expect } from "vitest";
import { isNotificationsPaused } from "@/lib/telegram/notify";

const NOW = new Date("2026-08-07T09:00:00Z");

describe("isNotificationsPaused", () => {
  it("is false when nothing is set", () => {
    expect(isNotificationsPaused(null, NOW)).toBe(false);
    expect(isNotificationsPaused(undefined, NOW)).toBe(false);
  });

  it("is true while the paused-until time is still in the future", () => {
    expect(isNotificationsPaused(new Date("2026-08-08T00:00:00Z"), NOW)).toBe(true);
  });

  it("is false once the paused-until time has passed", () => {
    expect(isNotificationsPaused(new Date("2026-08-01T00:00:00Z"), NOW)).toBe(false);
  });

  it("is false exactly at the boundary (not still-future)", () => {
    expect(isNotificationsPaused(NOW, NOW)).toBe(false);
  });

  it("accepts an ISO string (as read back from the DB) the same as a Date", () => {
    expect(isNotificationsPaused("2026-08-08T00:00:00.000Z", NOW)).toBe(true);
    expect(isNotificationsPaused("2026-08-01T00:00:00.000Z", NOW)).toBe(false);
  });

  it("fails safe (not paused) on garbage input", () => {
    expect(isNotificationsPaused("not-a-date" as unknown as string, NOW)).toBe(false);
  });
});
