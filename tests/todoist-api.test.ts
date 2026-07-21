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
  it("maps title, description, priority; routes to Inbox (no project_id) with a business label", () => {
    const body = buildTodoistCreateBody(makeTask(), heya);
    expect(body).toEqual({
      content: "Review June discrepancy report",
      description: "From the ops meeting.",
      priority: 3,
      labels: ["Heya"],
    });
    expect(body).not.toHaveProperty("project_id");
  });

  it("never sets project_id (everything goes to the Inbox)", () => {
    const personal: Business = { ...heya, key: "personal", name: "Personal", todoist_project_id: null };
    expect(buildTodoistCreateBody(makeTask(), personal)).not.toHaveProperty("project_id");
    expect(buildTodoistCreateBody(makeTask(), heya)).not.toHaveProperty("project_id");
  });

  it("formats Date-object due dates as YYYY-MM-DD (pg returns Date columns as Dates)", () => {
    const body = buildTodoistCreateBody(makeTask({ due_date: new Date("2026-07-15T00:00:00Z") }), heya);
    expect(body.due_date).toBe("2026-07-15");
  });

  it("combines task labels with the business label; both optional", () => {
    const withDue = buildTodoistCreateBody(
      makeTask({ due_date: "2026-07-15" as unknown as Date, labels: ["finance"] }),
      heya
    );
    expect(withDue.due_date).toBe("2026-07-15");
    expect(withDue.labels).toEqual(["finance", "Heya"]);
    const noBusiness = buildTodoistCreateBody(makeTask(), null);
    expect(noBusiness).not.toHaveProperty("due_date");
    expect(noBusiness).not.toHaveProperty("labels");
  });

  it("sets the Todoist Deadline field only when a deadline is supplied", () => {
    expect(buildTodoistCreateBody(makeTask(), heya)).not.toHaveProperty("deadline_date");
    const withDeadline = buildTodoistCreateBody(makeTask(), heya, "2026-08-15");
    expect(withDeadline.deadline_date).toBe("2026-08-15");
    // Deadline is independent of the due/scheduling date.
    expect(withDeadline).not.toHaveProperty("due_date");
    const dateObj = buildTodoistCreateBody(makeTask(), heya, "2026-08-15T00:00:00Z");
    expect(dateObj.deadline_date).toBe("2026-08-15");
  });
});
