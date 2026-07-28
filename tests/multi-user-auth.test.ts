import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
import { emailDomainAllowed } from "@/lib/env";

const SECRET = "test-secret-at-least-32-characters-long!!";

describe("session token carries userId", () => {
  it("round-trips userId + email and validates the signature", async () => {
    const token = await createSessionToken("user-123", "dean@heya.team", SECRET);
    const payload = await verifySessionToken(token, SECRET);
    expect(payload?.userId).toBe("user-123");
    expect(payload?.email).toBe("dean@heya.team");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken("user-123", "dean@heya.team", SECRET);
    expect(await verifySessionToken(token, "another-secret-at-least-32-chars-xxxxx")).toBeNull();
  });

  it("rejects a legacy email-only token (no userId) — forces re-login", async () => {
    // Hand-craft a token whose payload lacks userId, signed with the real secret.
    const enc = new TextEncoder();
    const body = Buffer.from(JSON.stringify({ email: "dean@heya.team", exp: Date.now() + 100000 }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const key = await crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
    let bin = "";
    for (const b of sig) bin += String.fromCharCode(b);
    const sigB64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifySessionToken(`${body}.${sigB64}`, SECRET)).toBeNull();
  });
});

describe("sign-up domain gate (fails closed)", () => {
  it("allows only listed domains", () => {
    const domains = ["heya.team", "justimagineconsulting.co.za"];
    expect(emailDomainAllowed("someone@heya.team", domains)).toBe(true);
    expect(emailDomainAllowed("dean@JustImagineConsulting.co.za".toLowerCase(), domains)).toBe(true);
    expect(emailDomainAllowed("outsider@gmail.com", domains)).toBe(false);
  });

  it("fails closed when no domains are configured", () => {
    expect(emailDomainAllowed("someone@heya.team", [])).toBe(false);
  });

  it("rejects malformed emails", () => {
    expect(emailDomainAllowed("not-an-email", ["heya.team"])).toBe(false);
  });
});
