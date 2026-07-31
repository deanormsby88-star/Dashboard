import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/repo", () => ({
  ensureOwner: async () => ({ user: { id: "owner-1" } }),
}));
vi.mock("@/lib/todoist/api", () => ({
  listActiveTodoistTasks: async () => [
    { id: "t1", content: "Owner task", priority: 1, url: null, due: { date: "2026-08-05" } },
  ],
}));

import { listTodoistTasksForUser } from "@/lib/todoist/scoped";

describe("listTodoistTasksForUser", () => {
  it("returns the global Todoist tasks for the owner", async () => {
    const tasks = await listTodoistTasksForUser("owner-1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].content).toBe("Owner task");
  });

  it("returns nothing for any other user (no cross-account leak)", async () => {
    expect(await listTodoistTasksForUser("colleague-2")).toEqual([]);
    expect(await listTodoistTasksForUser("")).toEqual([]);
  });
});
