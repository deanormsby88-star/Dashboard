import { beforeEach, describe, expect, it, vi } from "vitest";
import basic from "./fixtures/circleback/meeting-basic.json";

/**
 * Integration tests for the Circleback ingestion pipeline with the DB and
 * Meeting Processor replaced by in-memory fakes. Exercises the full path a
 * Zapier request takes: auth → idempotency → validation → storage → processing.
 */

const TEST_SECRET = "test-zapier-secret-0123456789";

// In-memory state standing in for Postgres.
const state = {
  webhookEvents: new Map<string, { id: string; status: string; error: string | null }>(),
  meetings: new Map<string, { id: string; title: string }>(),
  sourceRecords: new Map<string, unknown>(),
  processCalls: [] as string[],
  attendees: new Map<string, unknown[]>(),
};
let nextId = 1;

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    ZAPIER_WEBHOOK_SECRET: TEST_SECRET,
    DEANOS_EMAIL: "deano@heya.team",
    APP_URL: "http://localhost:3000",
  }),
}));

vi.mock("@/lib/db/repo", () => ({
  ensureOwner: vi.fn(async () => ({
    user: { id: "user-1", email: "deano@heya.team", name: "Dean" },
    businesses: [],
  })),
  recordWebhookEvent: vi.fn(async (params: { idempotencyKey: string }) => {
    const existing = state.webhookEvents.get(params.idempotencyKey);
    if (existing) return { id: existing.id, duplicate: true };
    const id = `evt-${nextId++}`;
    state.webhookEvents.set(params.idempotencyKey, { id, status: "received", error: null });
    return { id, duplicate: false };
  }),
  updateWebhookEvent: vi.fn(async (id: string, status: string, error?: string | null) => {
    for (const evt of state.webhookEvents.values()) {
      if (evt.id === id) {
        evt.status = status;
        evt.error = error ?? null;
      }
    }
  }),
  upsertSourceRecord: vi.fn(async (params: { sourceRecordId: string; payload: unknown }) => {
    state.sourceRecords.set(params.sourceRecordId, params.payload);
    return `src-${params.sourceRecordId}`;
  }),
  upsertMeeting: vi.fn(async (params: { sourceRecordId: string; title: string }) => {
    const existing = state.meetings.get(params.sourceRecordId);
    if (existing) return { meeting: existing, created: false };
    const meeting = { id: `meeting-${nextId++}`, title: params.title };
    state.meetings.set(params.sourceRecordId, meeting);
    return { meeting, created: true };
  }),
  replaceMeetingAttendees: vi.fn(async (meetingId: string, attendees: unknown[]) => {
    state.attendees.set(meetingId, attendees);
  }),
}));

vi.mock("@/lib/processors/meeting", () => ({
  processMeeting: vi.fn(async (meetingId: string) => {
    state.processCalls.push(meetingId);
    return {
      ok: true,
      counts: { tasks: 2, tasksSkippedAsDuplicates: 0, commitments: 2, waitingOn: 1, decisions: 1, risks: 1, relationshipUpdates: 0 },
    };
  }),
}));

import { ingestCircleback } from "@/lib/ingest/circleback";
import { processMeeting } from "@/lib/processors/meeting";

function headers(overrides: Record<string, string> = {}): Headers {
  return new Headers({ "x-deanos-secret": TEST_SECRET, ...overrides });
}

beforeEach(() => {
  state.webhookEvents.clear();
  state.meetings.clear();
  state.sourceRecords.clear();
  state.attendees.clear();
  state.processCalls = [];
  vi.mocked(processMeeting).mockClear();
});

describe("ingestCircleback", () => {
  const rawBody = JSON.stringify(basic);

  it("rejects requests without the shared secret and stores nothing", async () => {
    const result = await ingestCircleback(new Headers(), rawBody);
    expect(result.status).toBe(401);
    expect(state.webhookEvents.size).toBe(0);
    expect(state.meetings.size).toBe(0);
  });

  it("rejects requests with a wrong secret", async () => {
    const result = await ingestCircleback(new Headers({ "x-deanos-secret": "wrong" }), rawBody);
    expect(result.status).toBe(401);
  });

  it("rejects stale timestamps (replay protection)", async () => {
    const result = await ingestCircleback(
      headers({ "x-deanos-timestamp": "2020-01-01T00:00:00Z" }),
      rawBody
    );
    expect(result.status).toBe(401);
    expect(result.body.error).toMatch(/replay|stale/i);
  });

  it("ingests a valid payload end to end: stores source, meeting, attendees, and processes", async () => {
    const result = await ingestCircleback(headers(), rawBody);
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);

    // raw payload preserved
    expect(state.sourceRecords.get("cb-meeting-1001")).toEqual(basic);
    // meeting stored
    expect(state.meetings.get("cb-meeting-1001")?.title).toContain("Heya Ops Weekly");
    // attendees stored
    const meetingId = state.meetings.get("cb-meeting-1001")!.id;
    expect(state.attendees.get(meetingId)).toHaveLength(3);
    // processor ran exactly once
    expect(state.processCalls).toEqual([meetingId]);
    // webhook event marked processed
    const evt = [...state.webhookEvents.values()][0];
    expect(evt.status).toBe("processed");
  });

  it("absorbs replays of the same payload without duplicates (acceptance criterion 11)", async () => {
    const first = await ingestCircleback(headers(), rawBody);
    expect(first.status).toBe(200);
    const replay = await ingestCircleback(headers(), rawBody);
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);

    expect(state.meetings.size).toBe(1);
    expect(state.processCalls).toHaveLength(1); // processor did NOT run again
    expect(state.webhookEvents.size).toBe(1);
  });

  it("honours an explicit idempotency key header", async () => {
    const first = await ingestCircleback(headers({ "x-idempotency-key": "same-key" }), rawBody);
    expect(first.status).toBe(200);
    // Different body, same key → treated as duplicate.
    const other = await ingestCircleback(
      headers({ "x-idempotency-key": "same-key" }),
      JSON.stringify({ ...basic, meetingId: "cb-other" })
    );
    expect(other.body.duplicate).toBe(true);
    expect(state.meetings.size).toBe(1);
  });

  it("records invalid JSON as a failed event instead of dropping it", async () => {
    const result = await ingestCircleback(headers(), "this is not json{");
    expect(result.status).toBe(400);
    const evt = [...state.webhookEvents.values()][0];
    expect(evt.status).toBe("failed");
    expect(evt.error).toMatch(/JSON/i);
  });

  it("records structurally invalid payloads as failed events with a readable error", async () => {
    const result = await ingestCircleback(headers(), JSON.stringify({ title: "No ID" }));
    expect(result.status).toBe(422);
    expect(result.body.error).toMatch(/nothing to process/i);
    const evt = [...state.webhookEvents.values()][0];
    expect(evt.status).toBe("failed");
  });

  it("reports processing failure in the response but keeps ingestion successful", async () => {
    vi.mocked(processMeeting).mockResolvedValueOnce({ ok: false, error: "OpenAI exploded" });
    const result = await ingestCircleback(headers(), rawBody);
    expect(result.status).toBe(200);
    expect(result.body.processing).toEqual({ status: "failed", error: "OpenAI exploded" });
    // Meeting still stored and retryable.
    expect(state.meetings.size).toBe(1);
  });
});
