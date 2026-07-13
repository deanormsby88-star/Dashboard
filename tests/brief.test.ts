import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * generateDailyBrief composes structured fields + human text from the state
 * snapshot and prioritizer. Both dependencies are faked so this stays a pure
 * formatting/shape test.
 */

const snapshot = {
  today: "2026-07-13",
  tasks_awaiting_review: [{ title: "Review report", priority: 3, due_date: null }],
  open_tasks_in_todoist: [],
  waiting_on: [
    { text: "Lawrence to send proposal", person: "Lawrence", business_days_waiting: 4, needs_escalation: true },
    { text: "Priya artwork", person: "Priya", business_days_waiting: 1, needs_escalation: false },
  ],
  commitments_by_dean: [],
  open_risks: [{ description: "Payroll may recur", severity: "high" }],
  recent_meetings: [],
  unresolved_inbox_items: 2,
};

vi.mock("@/lib/assistant/state", () => ({
  buildSnapshot: vi.fn(async () => snapshot),
}));

const prioritizerOutput = {
  top_three: [
    { title: "Fix payroll", why: "Legal exposure." },
    { title: "Reply to Sam", why: "Client waiting." },
  ],
  ignore_today: ["LinkedIn"],
  becoming_risks: [],
  waiting_on_dean: [],
  chase: ["Lawrence — proposal"],
  recommendation: "Payroll first.",
};

const runPrioritizer = vi.fn(async () => ({ ok: true, output: prioritizerOutput }));
vi.mock("@/lib/assistant/prioritize", () => ({
  runPrioritizer: (...args: unknown[]) => runPrioritizer(...(args as [])),
  formatTop3: (o: typeof prioritizerOutput) =>
    o.top_three.map((t, i) => `${i + 1}. ${t.title}\n   ${t.why}`).join("\n"),
}));

vi.mock("@/lib/db/repo", () => ({
  ensureOwner: vi.fn(async () => ({ user: { id: "u1" }, businesses: [] })),
  insertBrief: vi.fn(async (p: unknown) => ({ id: "b1", ...(p as object) })),
}));

import { generateDailyBrief } from "@/lib/assistant/brief";

beforeEach(() => runPrioritizer.mockClear());

describe("generateDailyBrief", () => {
  it("returns structured top3, chase, ignore list and recommendation", async () => {
    const b = await generateDailyBrief(new Date("2026-07-13T06:00:00Z"));
    expect(b.ok).toBe(true);
    expect(b.date).toBe("2026-07-13");
    expect(b.top3).toHaveLength(2);
    expect(b.ignoreToday).toEqual(["LinkedIn"]);
    expect(b.chase).toEqual(["Lawrence — proposal"]);
    expect(b.recommendation).toBe("Payroll first.");
  });

  it("composes the 4-section message (date, weather, calendar, tasks)", async () => {
    const b = await generateDailyBrief(new Date("2026-07-13T06:00:00Z"));
    expect(b.text).toContain("📋 DAILY BRIEF — Monday, 13 July 2026");
    expect(b.text).toContain("📅 Calendar (0)");
    expect(b.text).toContain("Nothing scheduled today.");
    expect(b.text).toContain("✅ Tasks (0)");
    expect(b.text).toContain("Nothing due today.");
  });

  it("falls back to escalations for chase when the prioritizer fails", async () => {
    runPrioritizer.mockResolvedValueOnce({ ok: false, error: "boom" } as never);
    const b = await generateDailyBrief(new Date("2026-07-13T06:00:00Z"));
    expect(b.ok).toBe(false);
    expect(b.top3).toEqual([]);
    // escalated waiting-on item still surfaces as something to chase (dashboard field)
    expect(b.chase.some((c) => c.includes("Lawrence"))).toBe(true);
  });
});
