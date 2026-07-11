import { describe, it, expect } from "vitest";
import { senderAddress, mailtoLink } from "@/lib/email/draft";

describe("senderAddress", () => {
  it("extracts the address from a 'Name <addr>' sender", () => {
    expect(senderAddress("Lawrence Green <lawrence@acme.co.za>")).toBe("lawrence@acme.co.za");
  });
  it("passes through a bare address", () => {
    expect(senderAddress("dean@heya.team")).toBe("dean@heya.team");
  });
});

describe("mailtoLink", () => {
  it("prefixes Re: and encodes recipient, subject and body", () => {
    const link = mailtoLink("a@b.com", "Proposal", "Hi,\nSounds good.\nDean");
    expect(link).toContain("mailto:a%40b.com");
    expect(link).toContain("subject=Re%3A%20Proposal");
    expect(link).toContain("body=Hi%2C%0ASounds%20good.%0ADean");
  });
  it("does not double-prefix an existing Re:", () => {
    expect(mailtoLink("a@b.com", "Re: Proposal", "x")).toContain("subject=Re%3A%20Proposal");
  });
});
