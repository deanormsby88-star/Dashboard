import { describe, expect, it } from "vitest";
import { isRemovedPerson } from "@/lib/people/removed";

describe("isRemovedPerson", () => {
  it("removes everyone on the heya.team domain, case-insensitively", () => {
    expect(isRemovedPerson({ email: "lisaw@heya.team" })).toBe(true);
    expect(isRemovedPerson({ email: "LisaW@Heya.Team" })).toBe(true);
    expect(isRemovedPerson({ full_name: "Someone", email: "someone@heya.team" })).toBe(true);
  });

  it("keeps everyone else", () => {
    expect(isRemovedPerson({ full_name: "Lisa Simpson", email: "lisa@example.com" })).toBe(false);
    expect(isRemovedPerson({ email: "dean@justimagineconsulting.co.za" })).toBe(false);
    expect(isRemovedPerson({ full_name: "No Email" })).toBe(false);
    expect(isRemovedPerson({})).toBe(false);
  });
});
