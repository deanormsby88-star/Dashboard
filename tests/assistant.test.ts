import { describe, expect, it } from "vitest";
import { parseCommand } from "@/lib/assistant/commands";
import { businessDaysBetween } from "@/lib/dates";
import { prioritizerJsonSchema, parsePrioritizerOutput } from "@/lib/ai/prompts/executive-prioritizer";
import { quickCaptureJsonSchema, parseQuickCaptureOutput } from "@/lib/ai/prompts/quick-capture";
import { meetingPrepJsonSchema } from "@/lib/ai/prompts/meeting-prep";

describe("parseCommand", () => {
  it("recognizes bare commands", () => {
    expect(parseCommand("sync")).toEqual({ cmd: "sync", args: "" });
    expect(parseCommand("  BRIEF  ")).toEqual({ cmd: "brief", args: "" });
  });

  it("splits command arguments", () => {
    expect(parseCommand("prep Lawrence Cole")).toEqual({ cmd: "prep", args: "Lawrence Cole" });
    expect(parseCommand("capture Chase printer quote by Friday")).toEqual({
      cmd: "capture",
      args: "Chase printer quote by Friday",
    });
  });

  it("routes everything else to chat", () => {
    expect(parseCommand("who owes me money?")).toEqual({ cmd: "chat", args: "who owes me money?" });
    expect(parseCommand("What should I do about the payroll issue")).toEqual({
      cmd: "chat",
      args: "What should I do about the payroll issue",
    });
  });
});

describe("businessDaysBetween", () => {
  // 2026-07-06 is a Monday.
  it("counts weekdays only", () => {
    expect(businessDaysBetween(new Date("2026-07-06"), new Date("2026-07-08"))).toBe(2); // Mon→Wed
    expect(businessDaysBetween(new Date("2026-07-06"), new Date("2026-07-13"))).toBe(5); // Mon→Mon
  });

  it("skips weekends entirely", () => {
    expect(businessDaysBetween(new Date("2026-07-10"), new Date("2026-07-13"))).toBe(1); // Fri→Mon
    expect(businessDaysBetween(new Date("2026-07-11"), new Date("2026-07-12"))).toBe(0); // Sat→Sun
  });

  it("returns 0 for same day or reversed input", () => {
    expect(businessDaysBetween(new Date("2026-07-08"), new Date("2026-07-08"))).toBe(0);
    expect(businessDaysBetween(new Date("2026-07-09"), new Date("2026-07-08"))).toBe(0);
  });
});

function checkStrict(schema: Record<string, unknown>): void {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("object")) {
    expect(schema.additionalProperties).toBe(false);
    const props = Object.keys((schema.properties ?? {}) as Record<string, unknown>);
    expect([...((schema.required ?? []) as string[])].sort()).toEqual(props.sort());
    for (const value of Object.values(schema.properties as Record<string, Record<string, unknown>>)) {
      checkStrict(value);
    }
  }
  if (schema.items) checkStrict(schema.items as Record<string, unknown>);
}

describe("assistant prompt JSON schemas are strict-mode compliant", () => {
  it("prioritizer", () => checkStrict(prioritizerJsonSchema));
  it("quick capture", () => checkStrict(quickCaptureJsonSchema));
  it("meeting prep", () => checkStrict(meetingPrepJsonSchema));
});

describe("prioritizer output parsing", () => {
  it("accepts a valid payload", () => {
    const valid = {
      top_three: [{ title: "Resolve payroll discrepancy", why: "Legal exposure if July repeats." }],
      ignore_today: ["LinkedIn notifications"],
      becoming_risks: [],
      waiting_on_dean: ["Sam — AI tool options"],
      chase: ["Lawrence — proposal"],
      recommendation: "Clear the payroll issue before anything else.",
    };
    expect(parsePrioritizerOutput(JSON.stringify(valid)).ok).toBe(true);
  });

  it("rejects more than three priorities", () => {
    const bad = {
      top_three: [1, 2, 3, 4].map((i) => ({ title: `t${i}`, why: "w" })),
      ignore_today: [],
      becoming_risks: [],
      waiting_on_dean: [],
      chase: [],
      recommendation: "",
    };
    expect(parsePrioritizerOutput(JSON.stringify(bad)).ok).toBe(false);
  });
});

describe("quick capture output parsing", () => {
  it("accepts a task capture", () => {
    const valid = {
      kind: "task",
      business: "jic",
      task: { title: "Chase printer quote", description: "", priority: 2, due_date: "2026-07-17" },
      waiting_on: null,
      risk: null,
      relationship_update: null,
      note: null,
    };
    expect(parseQuickCaptureOutput(JSON.stringify(valid)).ok).toBe(true);
  });

  it("rejects invented due-date formats", () => {
    const bad = {
      kind: "task",
      business: "jic",
      task: { title: "Chase printer quote", description: "", priority: 2, due_date: "Friday" },
      waiting_on: null,
      risk: null,
      relationship_update: null,
      note: null,
    };
    expect(parseQuickCaptureOutput(JSON.stringify(bad)).ok).toBe(false);
  });
});
