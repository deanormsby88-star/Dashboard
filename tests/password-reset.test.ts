import { describe, expect, it } from "vitest";
import { createResetToken, RESET_TTL_MS, peekResetUserId, verifyResetToken } from "@/lib/auth/reset";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

const SECRET = "test-session-secret-that-is-long-enough";
const HASH = "scrypt:c2FsdA==:aGFzaA==";
const NOW = 1_700_000_000_000;

describe("password reset tokens", () => {
  it("verifies a fresh token for the same password hash", () => {
    const token = createResetToken("user-1", HASH, SECRET, NOW);
    expect(peekResetUserId(token)).toBe("user-1");
    expect(verifyResetToken(token, HASH, SECRET, NOW + 1000)).toBe("user-1");
  });

  it("expires after the TTL", () => {
    const token = createResetToken("user-1", HASH, SECRET, NOW);
    expect(verifyResetToken(token, HASH, SECRET, NOW + RESET_TTL_MS + 1)).toBeNull();
  });

  it("is single-use: stops working once the password hash changes", () => {
    const token = createResetToken("user-1", HASH, SECRET, NOW);
    expect(verifyResetToken(token, "scrypt:bmV3:bmV3", SECRET, NOW + 1000)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = createResetToken("user-1", HASH, "another-secret-entirely-000000000", NOW);
    expect(verifyResetToken(token, HASH, SECRET, NOW + 1000)).toBeNull();
  });

  it("rejects a tampered user id", () => {
    const token = createResetToken("user-1", HASH, SECRET, NOW);
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "user-2", exp: NOW + RESET_TTL_MS, v: "x" })).toString("base64url");
    expect(verifyResetToken(`${forged}.${sig}`, HASH, SECRET, NOW + 1000)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyResetToken("not-a-token", HASH, SECRET, NOW)).toBeNull();
    expect(peekResetUserId("%%%")).toBeNull();
  });
});

describe("hashPassword", () => {
  it("produces a hash verifyPassword accepts", () => {
    const hash = hashPassword("correct horse battery");
    expect(hash.startsWith("scrypt:")).toBe(true);
    expect(verifyPassword("correct horse battery", hash)).toBe(true);
    expect(verifyPassword("wrong password", hash)).toBe(false);
  });
});
