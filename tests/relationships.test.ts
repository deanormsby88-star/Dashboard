import { describe, it, expect } from "vitest";
import {
  STALE_CONTACT_DAYS,
  contactIsStale,
  daysSince,
  isKeyContact,
} from "@/lib/accountability/relationships";

const NOW = new Date("2026-07-31T09:00:00Z");

describe("isKeyContact", () => {
  it("is true when motivations/notes are recorded", () => {
    expect(isKeyContact({ notes: "Cares about growth; ex-banker." })).toBe(true);
  });
  it("is false with no notes", () => {
    expect(isKeyContact({ notes: null })).toBe(false);
    expect(isKeyContact({ notes: "   " })).toBe(false);
    expect(isKeyContact({})).toBe(false);
  });
});

describe("daysSince", () => {
  it("counts whole days", () => {
    expect(daysSince(new Date("2026-07-21T09:00:00Z"), NOW)).toBe(10);
  });
  it("returns null with no baseline", () => {
    expect(daysSince(null, NOW)).toBeNull();
  });
  it("treats the epoch sentinel as no baseline", () => {
    expect(daysSince(new Date("1970-01-01T00:00:00Z"), NOW)).toBeNull();
  });
});

describe("contactIsStale", () => {
  it("is stale once past the threshold", () => {
    const old = new Date(NOW.getTime() - (STALE_CONTACT_DAYS + 1) * 86400_000);
    expect(contactIsStale(old, NOW)).toBe(true);
  });
  it("is not stale within the threshold", () => {
    const recent = new Date(NOW.getTime() - 10 * 86400_000);
    expect(contactIsStale(recent, NOW)).toBe(false);
  });
  it("is never stale without a baseline (never contacted)", () => {
    expect(contactIsStale(null, NOW)).toBe(false);
    expect(contactIsStale(new Date("1970-01-01T00:00:00Z"), NOW)).toBe(false);
  });
  it("respects a custom threshold", () => {
    const d = new Date(NOW.getTime() - 15 * 86400_000);
    expect(contactIsStale(d, NOW, 14)).toBe(true);
    expect(contactIsStale(d, NOW, 21)).toBe(false);
  });

  it("the default threshold is 6 weeks", () => {
    expect(STALE_CONTACT_DAYS).toBe(42);
  });
});
