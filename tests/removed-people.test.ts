import { describe, expect, it } from "vitest";
import { isRemovedPerson } from "@/lib/people/removed";
import { HEYA_DIRECTORY } from "@/lib/people/directory";

describe("isRemovedPerson", () => {
  it("matches Lisa by email and by full name", () => {
    expect(isRemovedPerson({ email: "lisaw@heya.team" })).toBe(true);
    expect(isRemovedPerson({ email: "LisaW@Heya.Team" })).toBe(true);
    expect(isRemovedPerson({ full_name: "Lisa Wainbergas" })).toBe(true);
  });

  it("does not catch other people, or a different Lisa", () => {
    expect(isRemovedPerson({ full_name: "Debbie Derman", email: "dderman@heya.team" })).toBe(false);
    expect(isRemovedPerson({ full_name: "Lisa Simpson", email: "lisa@example.com" })).toBe(false);
    expect(isRemovedPerson({})).toBe(false);
  });
});

describe("directory seed", () => {
  it("no longer contains Lisa (so a re-import won't restore her)", () => {
    expect(HEYA_DIRECTORY.some((e) => e.email === "lisaw@heya.team")).toBe(false);
    expect(HEYA_DIRECTORY.some((e) => /lisa/i.test(e.fullName))).toBe(false);
  });
});
