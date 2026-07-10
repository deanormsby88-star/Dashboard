import { describe, expect, it } from "vitest";
import {
  normalizeAddress,
  normalizeEmailPayload,
  stripHtml,
} from "@/lib/email/schema";
import actionEmail from "./fixtures/email/email-action.json";
import newsletter from "./fixtures/email/email-newsletter.json";

describe("normalizeAddress", () => {
  it("extracts bare addresses from display forms", () => {
    expect(normalizeAddress("Dean Ormsby <deano@heya.team>")).toBe("deano@heya.team");
    expect(normalizeAddress("  SAM@Anchoroffices.COM.au ")).toBe("sam@anchoroffices.com.au");
  });
});

describe("stripHtml", () => {
  it("strips tags and decodes entities", () => {
    expect(stripHtml("<p>Hello&nbsp;<b>Dean</b> &amp; team</p>")).toBe("Hello Dean & team");
  });

  it("leaves plain text untouched", () => {
    expect(stripHtml("Plain text, 2 < 3")).toBe("Plain text, 2 < 3");
  });
});

describe("normalizeEmailPayload", () => {
  it("accepts an Outlook-style payload with explicit mailbox", () => {
    const result = normalizeEmailPayload(actionEmail);
    expect(result.ok).toBe(true);
    const p = result.payload!;
    expect(p.mailbox).toBe("heya");
    expect(p.direction).toBe("inbound"); // sender is not one of Dean's addresses
    expect(p.sender).toBe("sam@anchoroffices.com.au");
    expect(p.recipients).toEqual(["deano@heya.team"]);
    expect(p.messageId).toContain("anchoroffices");
    expect(p.threadId).toBe("AAQkAGI2T4MkzTQtM2QwYy00");
    expect(p.sourceUrl).toContain("outlook.office365.com");
    expect(p.flags).toEqual(["DeanOS"]);
  });

  it("strips HTML bodies (newsletter fixture)", () => {
    const result = normalizeEmailPayload(newsletter);
    expect(result.ok).toBe(true);
    expect(result.payload!.bodyText).not.toContain("<");
    expect(result.payload!.bodyText).toContain("Markets rallied");
  });

  it("infers mailbox from Dean's addresses when not explicit", () => {
    const result = normalizeEmailPayload({
      from: "someone@example.com",
      to: "dean@justimagineconsulting.co.za",
      subject: "Order query",
      body: "Where is our order?",
    });
    expect(result.ok).toBe(true);
    expect(result.payload!.mailbox).toBe("jic");
    expect(result.payload!.direction).toBe("inbound");
  });

  it("infers outbound direction when Dean is the sender", () => {
    const result = normalizeEmailPayload({
      from: "Dean Ormsby <deano@heya.team>",
      to: "lawrence@example.com",
      subject: "Please send the proposal",
      body: "Hi Lawrence, when can you get me the revised proposal?",
    });
    expect(result.ok).toBe(true);
    expect(result.payload!.mailbox).toBe("heya");
    expect(result.payload!.direction).toBe("outbound");
  });

  it("derives a stable message ID when the feed has none", () => {
    const payload = {
      mailbox: "personal",
      from: "a@b.com",
      subject: "Hello",
      body: "World",
      date: "2026-07-10T09:00:00Z",
    };
    const a = normalizeEmailPayload(payload);
    const b = normalizeEmailPayload({ ...payload });
    expect(a.ok).toBe(true);
    expect(a.payload!.messageId).toMatch(/^derived-[0-9a-f]{24}$/);
    expect(a.payload!.messageId).toBe(b.payload!.messageId);
  });

  it("rejects payloads with no resolvable mailbox", () => {
    const result = normalizeEmailPayload({
      from: "x@y.com",
      to: "z@w.com",
      subject: "Hi",
      body: "there",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/mailbox/i);
  });

  it("rejects payloads with neither subject nor body", () => {
    const result = normalizeEmailPayload({ mailbox: "heya", from: "a@b.com" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nothing to process/i);
  });
});
