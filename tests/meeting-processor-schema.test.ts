import { describe, expect, it } from "vitest";
import {
  meetingProcessorJsonSchema,
  meetingProcessorOutputSchema,
  parseMeetingProcessorOutput,
  buildUserMessage,
} from "@/lib/ai/prompts/meeting-processor";
import validExtraction from "./fixtures/ai/meeting-extraction-valid.json";

describe("meeting processor output schema", () => {
  it("accepts a valid extraction fixture", () => {
    const result = meetingProcessorOutputSchema.safeParse(validExtraction);
    expect(result.success).toBe(true);
  });

  it("parseMeetingProcessorOutput round-trips a valid raw response", () => {
    const result = parseMeetingProcessorOutput(JSON.stringify(validExtraction));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.business).toBe("heya");
      expect(result.output.tasks).toHaveLength(2);
    }
  });

  it("fails closed on non-JSON output", () => {
    const result = parseMeetingProcessorOutput("Sorry, I cannot help with that.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid JSON/i);
  });

  it("fails closed on schema violations", () => {
    const bad = { ...validExtraction, business: "acme" };
    const result = parseMeetingProcessorOutput(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/business/);
  });

  it("rejects invented priorities and confidences out of range", () => {
    const bad = JSON.parse(JSON.stringify(validExtraction));
    bad.tasks[0].priority = 7;
    expect(parseMeetingProcessorOutput(JSON.stringify(bad)).ok).toBe(false);

    const bad2 = JSON.parse(JSON.stringify(validExtraction));
    bad2.tasks[0].confidence = 1.5;
    expect(parseMeetingProcessorOutput(JSON.stringify(bad2)).ok).toBe(false);
  });

  it("rejects malformed due dates", () => {
    const bad = JSON.parse(JSON.stringify(validExtraction));
    bad.tasks[0].due_date = "next Friday";
    expect(parseMeetingProcessorOutput(JSON.stringify(bad)).ok).toBe(false);
  });
});

describe("JSON schema for structured output mirrors the Zod schema", () => {
  function collectRequired(schema: Record<string, unknown>): void {
    // Structured outputs (strict mode) require every object to declare
    // additionalProperties:false and list all properties as required.
    if (schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object"))) {
      expect(schema.additionalProperties).toBe(false);
      const props = Object.keys((schema.properties ?? {}) as Record<string, unknown>);
      expect([...((schema.required ?? []) as string[])].sort()).toEqual(props.sort());
      for (const value of Object.values(schema.properties as Record<string, Record<string, unknown>>)) {
        collectRequired(value);
      }
    }
    if (schema.items) collectRequired(schema.items as Record<string, unknown>);
  }

  it("is strict-mode compliant everywhere", () => {
    collectRequired(meetingProcessorJsonSchema);
  });

  it("valid fixture also satisfies top-level JSON-schema property list", () => {
    const required = meetingProcessorJsonSchema.required as string[];
    for (const key of required) {
      expect(validExtraction).toHaveProperty(key);
    }
  });
});

describe("buildUserMessage", () => {
  it("includes title, action items, notes and transcript", () => {
    const message = buildUserMessage({
      meetingId: "cb-1",
      title: "Test meeting",
      meetingDate: "2026-07-08",
      attendees: ["Dean Ormsby", "Sam Wright"],
      notes: "the notes",
      transcript: "the transcript",
      actionItems: ["Do the thing"],
      sourceUrl: null,
    });
    expect(message).toContain("Test meeting");
    expect(message).toContain("- Do the thing");
    expect(message).toContain("the notes");
    expect(message).toContain("the transcript");
    expect(message).toContain("Dean Ormsby, Sam Wright");
  });
});
