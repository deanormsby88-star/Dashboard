import { describe, it, expect } from "vitest";
import { bucketDueTasks, composeDigest } from "@/lib/todoist/reminders";
import type { TodoistTask } from "@/lib/todoist/api";

const task = (id: string, content: string, date: string | null = null, priority = 1): TodoistTask => ({
  id,
  content,
  priority,
  url: null,
  due: date ? { date } : null,
});

describe("bucketDueTasks", () => {
  const today = "2026-07-11";
  const tasks = [
    task("1", "Overdue thing", "2026-07-09", 4),
    task("2", "Due today low", "2026-07-11", 1),
    task("3", "Future thing", "2026-07-20"),
    task("4", "No date"),
    task("5", "Due today urgent", "2026-07-11", 4),
  ];

  it("splits into overdue and today, ignoring future and undated", () => {
    const { overdue, today: due } = bucketDueTasks(tasks, today);
    expect(overdue.map((t) => t.id)).toEqual(["1"]);
    expect(due.map((t) => t.id)).toEqual(["5", "2"]); // sorted by priority desc
  });

  it("returns no digest when nothing is due", () => {
    const { overdue, today: due } = bucketDueTasks([task("3", "Future", "2026-07-20")], today);
    expect(composeDigest({ overdue, today: due })).toBeNull();
  });

  it("composes a digest listing overdue and today", () => {
    const digest = composeDigest(bucketDueTasks(tasks, today));
    expect(digest).toContain("3 due");
    expect(digest).toContain("Overdue (1)");
    expect(digest).toContain("Today (2)");
    expect(digest).toContain("Due today urgent");
  });
});
