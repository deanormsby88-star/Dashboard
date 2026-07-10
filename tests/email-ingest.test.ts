import { beforeEach, describe, expect, it, vi } from "vitest";
import actionEmail from "./fixtures/email/email-action.json";

/**
 * Integration tests for the email ingestion pipeline with DB and Email
 * Processor faked, mirroring the Circleback ingestion tests.
 */

const TEST_SECRET = "test-zapier-secret-0123456789";

const state = {
  webhookEvents: new Map<string, { id: string; status: string; error: string | null }>(),
  emails: new Map<string, { id: string; subject: string; processing_status: string }>(),
  sourceRecords: new Map<string, unknown>(),
  processCalls: [] as string[],
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
    businesses: [
      { id: "biz-heya", user_id: "user-1", key: "heya", name: "Heya", todoist_project_id: "x" },
    ],
  })),
  businessByKey: vi.fn((owner: { businesses: Array<{ key: string }> }, key: string) =>
    owner.businesses.find((b) => b.key === key) ?? null
  ),
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
  upsertEmail: vi.fn(async (params: { messageId: string; subject: string }) => {
    const existing = state.emails.get(params.messageId);
    if (existing) return { email: existing, created: false };
    const email = { id: `email-${nextId++}`, subject: params.subject, processing_status: "pending" };
    state.emails.set(params.messageId, email);
    return { email, created: true };
  }),
}));

vi.mock("@/lib/processors/email", () => ({
  processEmail: vi.fn(async (emailId: string) => {
    state.processCalls.push(emailId);
    return { ok: true, classification: "action", counts: { tasks: 1, waitingOn: 0, risks: 0, relationshipUpdates: 0, resolvedWaitingOn: 0 } };
  }),
}));

import { ingestEmail } from "@/lib/ingest/email";
import { processEmail } from "@/lib/processors/email";

function headers(overrides: Record<string, string> = {}): Headers {
  return new Headers({ "x-deanos-secret": TEST_SECRET, ...overrides });
}

beforeEach(() => {
  state.webhookEvents.clear();
  state.emails.clear();
  state.sourceRecords.clear();
  state.processCalls = [];
  vi.mocked(processEmail).mockClear();
});

describe("ingestEmail", () => {
  const rawBody = JSON.stringify(actionEmail);

  it("rejects requests without the shared secret", async () => {
    const result = await ingestEmail(new Headers(), rawBody);
    expect(result.status).toBe(401);
    expect(state.webhookEvents.size).toBe(0);
  });

  it("ingests a valid email end to end and processes it", async () => {
    const result = await ingestEmail(headers(), rawBody);
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(state.emails.size).toBe(1);
    expect(state.processCalls).toHaveLength(1);
    const evt = [...state.webhookEvents.values()][0];
    expect(evt.status).toBe("processed");
    expect(
      (result.body.processing as { classification?: string }).classification
    ).toBe("action");
  });

  it("absorbs replays without reprocessing", async () => {
    await ingestEmail(headers(), rawBody);
    const replay = await ingestEmail(headers(), rawBody);
    expect(replay.body.duplicate).toBe(true);
    expect(state.emails.size).toBe(1);
    expect(state.processCalls).toHaveLength(1);
  });

  it("skips reprocessing an already-processed email arriving via a new event", async () => {
    await ingestEmail(headers(), rawBody);
    // Same email, different webhook event (e.g. re-flagged in Outlook).
    state.emails.get(
      "<CAJx9SamSimon123@mail.anchoroffices.com.au>".trim().toLowerCase().includes("@")
        ? [...state.emails.keys()][0]
        : ""
    )!.processing_status = "processed";
    const again = await ingestEmail(headers({ "x-idempotency-key": "different-key" }), rawBody);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(state.processCalls).toHaveLength(1);
  });

  it("records invalid payloads as failed events", async () => {
    const result = await ingestEmail(headers(), JSON.stringify({ from: "x@y.com", to: "z@w.com", subject: "Hi", body: "there" }));
    expect(result.status).toBe(422);
    const evt = [...state.webhookEvents.values()][0];
    expect(evt.status).toBe("failed");
    expect(evt.error).toMatch(/mailbox/i);
  });

  it("keeps ingestion successful when processing fails", async () => {
    vi.mocked(processEmail).mockResolvedValueOnce({ ok: false, error: "model exploded" });
    const result = await ingestEmail(headers(), rawBody);
    expect(result.status).toBe(200);
    expect(result.body.processing).toEqual({ status: "failed", error: "model exploded" });
    expect(state.emails.size).toBe(1);
  });
});
