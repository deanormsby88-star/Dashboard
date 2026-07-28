import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Data-isolation guard. Multi-tenant safety depends on every query against a
 * user-scoped table being filtered by user_id. This scans the data layer's SQL
 * template literals and fails if any query against a content-bearing,
 * user-scoped table lacks a `user_id` predicate — catching a regression before
 * it can leak one user's data to another.
 */

// Tables that hold per-user content. A query touching one MUST mention user_id
// (directly or via a join alias like m.user_id).
const USER_SCOPED_TABLES = [
  "tasks",
  "meetings",
  "commitments",
  "decisions",
  "risks",
  "interactions",
  "people",
  "emails",
  "briefs",
  "calendar_events",
  "calendar_connections",
  "conversation_messages",
  "source_records",
];

// Intentional exceptions: queries keyed by an unguessable identifier coming
// from a trusted server-side source (Todoist/Zapier webhooks), not by a user
// request. Documented as background-only, single-tenant until Phase 2.
const ALLOWED_WITHOUT_USER_ID = [
  "update tasks set status = 'created', todoist_task_id", // markTaskCreatedByDedupKey (by dedup_key / id)
  "update tasks set status = 'completed'", // completeTaskByTodoistId (by todoist_task_id)
  "from sync_runs", // KV dedup store; source_system is namespaced (Phase 2 scoping)
  "delete from sync_runs", // pruneOldSyncRuns (housekeeping)
  "into sync_runs", // recordSyncRun (write carries user_id in columns)
  // Trusted background meeting processor/ingest: keyed by the meeting's own
  // (user-owned, unguessable) UUID, never by a user request.
  "update meetings set", // setMeetingProcessing (by meeting id)
  "delete from tasks where meeting_id", // clearSuggestedExtractions
  "delete from commitments where meeting_id",
  "delete from decisions where meeting_id",
  "delete from risks where meeting_id",
  "delete from interactions where meeting_id",
  "meeting_attendees", // scoped via join to meetings.user_id, or keyed by meeting_id
];

function extractSqlTemplates(src: string): string[] {
  // Grab backtick template literals that look like SQL (contain a SQL verb).
  const templates: string[] = [];
  const re = /`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const body = m[1].toLowerCase();
    if (/\b(select|insert into|update|delete)\b/.test(body)) templates.push(body);
  }
  return templates;
}

describe("data-isolation guard (repo.ts)", () => {
  const repoPath = fileURLToPath(new URL("../src/lib/db/repo.ts", import.meta.url));
  const src = readFileSync(repoPath, "utf8");
  const templates = extractSqlTemplates(src);

  it("found SQL templates to check", () => {
    expect(templates.length).toBeGreaterThan(30);
  });

  it("every query against a user-scoped table filters by user_id", () => {
    const offenders: string[] = [];
    for (const t of templates) {
      const touchesScoped = USER_SCOPED_TABLES.some((tbl) =>
        new RegExp(`\\b(from|into|update|join)\\s+${tbl}\\b`).test(t)
      );
      if (!touchesScoped) continue;
      if (t.includes("user_id")) continue;
      if (ALLOWED_WITHOUT_USER_ID.some((a) => t.includes(a))) continue;
      offenders.push(t.replace(/\s+/g, " ").trim().slice(0, 120));
    }
    expect(offenders, `Unscoped user-table queries:\n${offenders.join("\n")}`).toEqual([]);
  });
});
