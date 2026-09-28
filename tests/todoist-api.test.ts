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

const jic: Business = {
  id: "b-1",
  user_id: "u-1",
  key: "jic",
  name: "JIC",
  todoist_project_id: "6Crg2Ch856x5xC46",
};

describe("buildTodoistCreateBody", () => {
  it("maps title, description, priority; routes to Inbox (no project_id) with a business label", () => {
    const body = buildTodoistCreateBody(makeTask(), jic);
    expect(body).toEqual({
      content: "Review June discrepancy report",
      description: "From the ops meeting.",
      priority: 3,
      labels: ["JIC"],
    });
    expect(body).not.toHaveProperty("project_id");
  });

  it("never sets project_id (everything goes to the Inbox)", () => {
    const personal: Business = { ...jic, key: "personal", name: "Personal", todoist_project_id: null };
    expect(buildTodoistCreateBody(makeTask(), personal)).not.toHaveProperty("project_id");
    expect(buildTodoistCreateBody(makeTask(), jic)).not.toHaveProperty("project_id");
  });

  it("formats Date-object due dates as YYYY-MM-DD (pg returns Date columns as Dates)", () => {
    const body = buildTodoistCreateBody(makeTask({ due_date: new Date("2026-07-15T00:00:00Z") }), jic);
    expect(body.due_date).toBe("2026-07-15");
  });

  it("combines task labels with the business label; both optional", () => {
    const withDue = buildTodoistCreateBody(
      makeTask({ due_date: "2026-07-15" as unknown as Date, labels: ["finance"] }),
      jic
    );
    expect(withDue.due_date).toBe("2026-07-15");
    expect(withDue.labels).toEqual(["finance", "JIC"]);
    const noBusiness = buildTodoistCreateBody(makeTask(), null);
    expect(noBusiness).not.toHaveProperty("due_date");
    expect(noBusiness).not.toHaveProperty("labels");
  });

  it("tags an owed-to-you task with the person and the business", () => {
    // waiting_on tasks carry the person as their first label.
    const body = buildTodoistCreateBody(makeTask({ labels: ["Thabo Mokoena"] }), jic, "2026-08-14");
    expect(body.labels).toEqual(["Thabo Mokoena", "JIC"]);
    expect(body.deadline_date).toBe("2026-08-14");
  });

  it("sets the Todoist Deadline field only when a deadline is supplied", () => {
    expect(buildTodoistCreateBody(makeTask(), jic)).not.toHaveProperty("deadline_date");
    const withDeadline = buildTodoistCreateBody(makeTask(), jic, "2026-08-15");
    expect(withDeadline.deadline_date).toBe("2026-08-15");
    // Deadline is independent of the due/scheduling date.
    expect(withDeadline).not.toHaveProperty("due_date");
    const dateObj = buildTodoistCreateBody(makeTask(), jic, "2026-08-15T00:00:00Z");
    expect(dateObj.deadline_date).toBe("2026-08-15");
  });
});
