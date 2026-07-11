import { describe, it, expect } from "vitest";
import { wazeLink } from "@/lib/maps";

describe("wazeLink", () => {
  it("builds a navigating Waze deep link", () => {
    expect(wazeLink("Senderwood")).toBe("https://www.waze.com/ul?q=Senderwood&navigate=yes");
  });

  it("url-encodes locations with spaces and punctuation", () => {
    expect(wazeLink("New Office, 12 Main Rd")).toBe(
      "https://www.waze.com/ul?q=New%20Office%2C%2012%20Main%20Rd&navigate=yes"
    );
  });
});
