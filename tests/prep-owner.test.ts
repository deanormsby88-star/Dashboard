import { describe, expect, it } from "vitest";
import { isOwnerAttendee } from "@/lib/calendar/prep";

describe("isOwnerAttendee (Dean must never appear as an attendee to prep about)", () => {
  it("matches Dean by name", () => {
    expect(isOwnerAttendee("Dean Ormsby")).toBe(true);
    expect(isOwnerAttendee("dean ormsby")).toBe(true);
  });

  it("matches Dean by any of his mailbox addresses", () => {
    expect(expect(isOwnerAttendee("dean@justimagineconsulting.co.za")).toBe(true);
    expect(isOwnerAttendee("dean.ormsby88@gmail.com")).toBe(true);
  });

  it("matches a resolved person record for Dean", () => {
    expect(isOwnerAttendee(null, { full_name: "Dean Ormsby", email: null } as never)).toBe(true);
    expect(isOwnerAttendee(null, { full_name: "Dean", email: "dean@justimagineconsulting.co.za" } as never)).toBe(true);
  });

  it("does not match other attendees", () => {
    expect(isOwnerAttendee("Alex Smith")).toBe(false);
    expect(isOwnerAttendee("alex@example.com")).toBe(false);
    expect(isOwnerAttendee(null, { full_name: "Jordan Lee", email: "jordan@example.com" } as never)).toBe(false);
  });
});
