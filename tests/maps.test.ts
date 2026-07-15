import { describe, it, expect } from "vitest";
import { wazeLink, wazeLinkFor } from "@/lib/maps";

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

describe("wazeLinkFor", () => {
  it("links to a real physical place", () => {
    expect(wazeLinkFor("Senderwood")).toBe("https://www.waze.com/ul?q=Senderwood&navigate=yes");
  });
  it("skips online meetings", () => {
    expect(wazeLinkFor("Microsoft Teams Meeting")).toBeNull();
    expect(wazeLinkFor("Zoom")).toBeNull();
    expect(wazeLinkFor("https://teams.microsoft.com/l/xyz")).toBeNull();
    expect(wazeLinkFor("Online")).toBeNull();
  });
  it("skips Dean's own workplace / internal rooms", () => {
    expect(wazeLinkFor("Heya SA, 2nd Floor, Beyachad")).toBeNull();
    expect(wazeLinkFor("Beyachad")).toBeNull();
    expect(wazeLinkFor("Dean's Office")).toBeNull();
    expect(wazeLinkFor("In Office")).toBeNull();
    expect(wazeLinkFor("Office")).toBeNull();
    expect(wazeLinkFor("Boardroom")).toBeNull();
  });
  it("still links genuine off-site client offices", () => {
    expect(wazeLinkFor("Anchor Offices, Cape Town")).not.toBeNull();
  });
  it("returns null for no location", () => {
    expect(wazeLinkFor(null)).toBeNull();
    expect(wazeLinkFor("  ")).toBeNull();
  });
});
