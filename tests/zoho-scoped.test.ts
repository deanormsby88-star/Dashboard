import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/repo", () => ({
  ensureOwner: async () => ({ user: { id: "owner-1", email: "dean@heya.team" } }),
  listSyncRunsBySource: async () => [
    { stats: { tasks: [{ id: "t1", title: "Team task" }], fetchedAt: "2026-08-01T00:00:00.000Z" } },
  ],
  recordSyncRun: async () => {},
}));
vi.mock("@/lib/zoho/client", () => ({
  zohoConfigured: () => true,
  listAllTasks: async () => [{ id: "t1", title: "Team task" }],
}));

import { listZohoTasksForUser, zohoLastSyncedAt } from "@/lib/zoho/scoped";

describe("listZohoTasksForUser", () => {
  it("returns the cached Zoho tasks for the owner", async () => {
    const tasks = await listZohoTasksForUser("owner-1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Team task");
  });

  it("returns nothing for any other user (Heya-only data must not leak)", async () => {
    expect(await listZohoTasksForUser("colleague-2")).toEqual([]);
    expect(await listZohoTasksForUser("")).toEqual([]);
  });
});

describe("zohoLastSyncedAt", () => {
  it("returns the sync time for the owner only", async () => {
    expect(await zohoLastSyncedAt("owner-1")).toBe("2026-08-01T00:00:00.000Z");
    expect(await zohoLastSyncedAt("colleague-2")).toBeNull();
  });
});
