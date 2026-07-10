import { describe, expect, it } from "vitest";
import {
  deriveIdempotencyKey,
  isTimestampFresh,
  verifySharedSecret,
} from "@/lib/webhooks/security";

describe("verifySharedSecret", () => {
  it("accepts a matching secret", () => {
    expect(verifySharedSecret("super-secret-value", "super-secret-value")).toBe(true);
  });

  it("rejects wrong, missing or empty secrets", () => {
    expect(verifySharedSecret("wrong", "super-secret-value")).toBe(false);
    expect(verifySharedSecret(null, "super-secret-value")).toBe(false);
    expect(verifySharedSecret("", "super-secret-value")).toBe(false);
    expect(verifySharedSecret("super-secret-value", "")).toBe(false);
  });

  it("rejects prefixes and different lengths", () => {
    expect(verifySharedSecret("super-secret", "super-secret-value")).toBe(false);
    expect(verifySharedSecret("super-secret-value-x", "super-secret-value")).toBe(false);
  });
});

describe("isTimestampFresh", () => {
  const now = Date.parse("2026-07-10T12:00:00Z");

  it("accepts a missing header (idempotency still protects)", () => {
    expect(isTimestampFresh(null, now)).toBe(true);
  });

  it("accepts timestamps within the window", () => {
    expect(isTimestampFresh("2026-07-10T11:58:00Z", now)).toBe(true);
    expect(isTimestampFresh(String(Math.floor(now / 1000) - 60), now)).toBe(true);
  });

  it("rejects stale timestamps (replay)", () => {
    expect(isTimestampFresh("2026-07-10T11:00:00Z", now)).toBe(false);
    expect(isTimestampFresh(String(Math.floor(now / 1000) - 3600), now)).toBe(false);
  });

  it("rejects garbage timestamps", () => {
    expect(isTimestampFresh("not-a-date", now)).toBe(false);
  });
});

describe("deriveIdempotencyKey", () => {
  it("uses the explicit header when present", () => {
    expect(deriveIdempotencyKey("zapier/circleback", "abc-123", "{}")).toBe(
      "zapier/circleback:abc-123"
    );
  });

  it("derives a stable key from the body when no header is sent", () => {
    const a = deriveIdempotencyKey("zapier/circleback", null, '{"meetingId":"1"}');
    const b = deriveIdempotencyKey("zapier/circleback", null, '{"meetingId":"1"}');
    const c = deriveIdempotencyKey("zapier/circleback", null, '{"meetingId":"2"}');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("scopes derived keys by endpoint", () => {
    expect(deriveIdempotencyKey("zapier/circleback", null, "{}")).not.toBe(
      deriveIdempotencyKey("zapier/todoist", null, "{}")
    );
  });
});
