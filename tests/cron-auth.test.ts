import { describe, expect, it } from "vitest";
import { clientIp, isRateLimited, recordFailure, recordSuccess } from "@/lib/auth/throttle";

describe("login throttle", () => {
  it("reads the client IP from x-forwarded-for (first hop), then x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("blocks only after the failure budget is exceeded, within the window", () => {
    const ip = "203.0.113.10";
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(isRateLimited(ip, t0)).toBe(false);
      recordFailure(ip, t0);
    }
    // 10 failures recorded → now limited.
    expect(isRateLimited(ip, t0)).toBe(true);
  });

  it("resets after the window elapses", () => {
    const ip = "203.0.113.11";
    const t0 = 2_000_000;
    for (let i = 0; i < 10; i++) recordFailure(ip, t0);
    expect(isRateLimited(ip, t0)).toBe(true);
    // 16 minutes later the window has rolled over.
    expect(isRateLimited(ip, t0 + 16 * 60 * 1000)).toBe(false);
  });

  it("a successful login clears the bucket", () => {
    const ip = "203.0.113.12";
    const t0 = 3_000_000;
    for (let i = 0; i < 10; i++) recordFailure(ip, t0);
    expect(isRateLimited(ip, t0)).toBe(true);
    recordSuccess(ip);
    expect(isRateLimited(ip, t0)).toBe(false);
  });
});
