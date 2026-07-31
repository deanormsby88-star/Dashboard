import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ SESSION_SECRET: "test-secret-for-display-tokens-1234567890" }),
}));

import { signDisplayToken, verifyDisplayToken } from "@/lib/display/token";

describe("display token", () => {
  it("round-trips a userId", () => {
    const t = signDisplayToken("user-abc");
    expect(verifyDisplayToken(t)).toBe("user-abc");
  });

  it("is stable (same token each time, so a device keeps working)", () => {
    expect(signDisplayToken("user-abc")).toBe(signDisplayToken("user-abc"));
  });

  it("gives different users different tokens", () => {
    expect(signDisplayToken("user-abc")).not.toBe(signDisplayToken("user-xyz"));
  });

  it("rejects a tampered token", () => {
    const t = signDisplayToken("user-abc");
    expect(verifyDisplayToken(t.slice(0, -2) + "xx")).toBeNull();
  });

  it("rejects junk", () => {
    expect(verifyDisplayToken("")).toBeNull();
    expect(verifyDisplayToken("not-a-token")).toBeNull();
  });
});
