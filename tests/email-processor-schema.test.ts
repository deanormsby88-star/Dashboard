import { describe, expect, it } from "vitest";
import {
  buildUserMessage,
  emailProcessorJsonSchema,
  emailProcessorOutputSchema,
  parseEmailProcessorOutput,
} from "@/lib/ai/prompts/email-processor";
import validAction from "./fixtures/ai/email-classification-action.json";

describe("email processor output schema", () => {
  it("accepts a valid action classification", () => {
    expect(emailProcessorOutputSchema.safeParse(validAction).success).toBe(true);
  });

  it("round-trips through the parser", () => {
    const result = parseEmailProcessorOutput(JSON.stringify(validAction));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.classification).toBe("action");
      expect(result.output.suggested_task?.title).toBe("Send Sam AI tool options");
    }
  });

  it("fails closed on invalid classification", () => {
    const bad = { ...validAction, classification: "urgent" };
    expect(parseEmailProcessorOutput(JSON.stringify(bad)).ok).toBe(false);
  });

  it("fails closed on invented due-date formats", () => {
    const bad = JSON.parse(JSON.stringify(validAction));
    bad.suggested_task.due_date = "Friday";
    expect(parseEmailProcessorOutput(JSON.stringify(bad)).ok).toBe(false);
  });

  it("fails closed on non-JSON", () => {
    expect(parseEmailProcessorOutput("nope").ok).toBe(false);
  });
});

describe("email JSON schema is strict-mode compliant", () => {
  function check(schema: Record<string, unknown>): void {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.includes("object")) {
      expect(schema.additionalProperties).toBe(false);
      const props = Object.keys((schema.properties ?? {}) as Record<string, unknown>);
      expect([...((schema.required ?? []) as string[])].sort()).toEqual(props.sort());
      for (const value of Object.values(schema.properties as Record<string, Record<string, unknown>>)) {
        check(value);
      }
    }
    if (schema.items) check(schema.items as Record<string, unknown>);
  }

  it("every object declares additionalProperties:false and full required list", () => {
    check(emailProcessorJsonSchema);
  });
});

describe("buildUserMessage", () => {
  it("includes the open waiting-on list with IDs", () => {
    const message = buildUserMessage({
      mailbox: "heya",
      direction: "inbound",
      sender: "lawrence@example.com",
      recipients: ["deano@heya.team"],
      subject: "Revised proposal attached",
      body: "Here is the revised team proposal.",
      emailDate: "2026-07-10T10:00:00Z",
      flags: [],
      openWaitingOn: [
        { id: "c-123", text: "Lawrence to send revised team proposal", person: "Lawrence Cole" },
      ],
    });
    expect(message).toContain("id: c-123");
    expect(message).toContain("Lawrence to send revised team proposal");
    expect(message).toContain("Revised proposal attached");
  });
});
