import { describe, expect, it } from "vitest";
import { buildTodoistCreateBody } from "@/lib/todoist/api";
import type { Business, Task } from "@/lib/types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    user_id: "u-1",
    business_id: "b-1",
    meeting_id: null,
    title: "Review June discrepancy report",
    description: "From the ops meeting.",
    priority: 3,
    due_date: null,
    labels: [],
    origin: "action_item",
    status: "approved",
    status_error: null,
    confidence: 0.9,
    todoist_task_id: null,
    todoist_task_url: null,
    source_system: "circleback",
    source_record_id: "cb-1",
    source_url: null,
    dedup_key: "k",
    ai_run_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

const heya: Business = {
  id: "b-1",
  user_id: "u-1",
  key: "heya",
  name: "Heya",
  todoist_project_id: "6h4cX6qV6VRX9gQ8",
};

describe("buildTodoistCreateBody", () => {
  it("maps title, description, priority and project", () => {
    const body = buildTodoistCreateBody(makeTask(), heya);
    expect(body).toEqual({
      content: "Review June discrepancy report",
      description: "From the ops meeting.",
      priority: 3,
      project_id: "6h4cX6qV6VRX9gQ8",
    });
  });

  it("omits project_id for Personal (Todoist Inbox)", () => {
    const personal: Business = { ...heya, key: "personal", name: "Personal", todoist_project_id: null };
    const body = buildTodoistCreateBody(makeTask(), personal);
    expect(body).not.toHaveProperty("project_id");
  });

  it("formats Date-object due dates as YYYY-MM-DD (pg returns Date columns as Dates)", () => {
    const body = buildTodoistCreateBody(makeTask({ due_date: new Date("2026-07-15T00:00:00Z") }), heya);
    expect(body.due_date).toBe("2026-07-15");
  });

  it("includes due_date and labels only when present", () => {
    const withDue = buildTodoistCreateBody(
      makeTask({ due_date: "2026-07-15" as unknown as Date, labels: ["finance"] }),
      heya
    );
    expect(withDue.due_date).toBe("2026-07-15");
    expect(withDue.labels).toEqual(["finance"]);
    const without = buildTodoistCreateBody(makeTask(), heya);
    expect(without).not.toHaveProperty("due_date");
    expect(without).not.toHaveProperty("labels");
  });
});
