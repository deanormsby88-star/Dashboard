import { scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Verifies a password against a hash in the format produced by
 * scripts/hash-password.mjs: `scrypt:<salt-b64>:<hash-b64>`.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "base64");
    const expected = Buffer.from(parts[2], "base64");
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
