import { describe, expect, it } from "vitest";
import { normalizeCirclebackPayload, parseMeetingDate } from "@/lib/circleback/schema";
import basic from "./fixtures/circleback/meeting-basic.json";
import flattened from "./fixtures/circleback/meeting-zapier-flattened.json";
import invalid from "./fixtures/circleback/meeting-invalid.json";

describe("normalizeCirclebackPayload", () => {
  it("accepts the canonical camelCase payload", () => {
    const result = normalizeCirclebackPayload(basic);
    expect(result.ok).toBe(true);
    const p = result.payload!;
    expect(p.meetingId).toBe("cb-meeting-1001");
    expect(p.title).toContain("Heya Ops Weekly");
    expect(p.attendees).toHaveLength(3);
    expect(p.attendees[0].name).toBe("Dean Ormsby");
    expect(p.actionItems).toHaveLength(2);
    expect(p.sourceUrl).toContain("circleback.ai");
  });

  it("accepts Zapier-flattened snake_case payloads with string lists", () => {
    const result = normalizeCirclebackPayload(flattened);
    expect(result.ok).toBe(true);
    const p = result.payload!;
    expect(p.meetingId).toBe("cb-meeting-1002");
    expect(p.title).toBe("JIC supplier call");
    expect(p.attendees.map((a) => a.name)).toEqual(["Dean Ormsby", "Priya Patel"]);
    expect(p.actionItems).toEqual(["Approve supplier artwork", "Chase freight quote"]);
  });

  it("rejects payloads without a meeting ID", () => {
    const result = normalizeCirclebackPayload(invalid);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/meeting ID/i);
  });

  it("rejects payloads with no content at all", () => {
    const result = normalizeCirclebackPayload({ meetingId: "x", title: "Empty" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nothing to process/i);
  });

  it("rejects non-object payloads", () => {
    expect(normalizeCirclebackPayload("nope").ok).toBe(false);
    expect(normalizeCirclebackPayload(null).ok).toBe(false);
    expect(normalizeCirclebackPayload([1, 2]).ok).toBe(false);
  });

  it("coerces numeric meeting IDs to strings", () => {
    const result = normalizeCirclebackPayload({
      id: 12345,
      title: "Numeric ID meeting",
      notes: "Some notes",
    });
    expect(result.ok).toBe(true);
    expect(result.payload!.meetingId).toBe("12345");
  });
});

describe("parseMeetingDate", () => {
  it("parses ISO dates", () => {
    expect(parseMeetingDate("2026-07-08T10:00:00+10:00")).toBeInstanceOf(Date);
    expect(parseMeetingDate("2026-07-09")).toBeInstanceOf(Date);
  });

  it("returns null for garbage or missing values", () => {
    expect(parseMeetingDate(null)).toBeNull();
    expect(parseMeetingDate("not a date")).toBeNull();
  });
});
