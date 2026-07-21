import { describe, expect, it } from "vitest";
import { isNoiseEmail, isNoiseSignal } from "@/lib/assistant/noise";

describe("isNoiseSignal (watch loop)", () => {
  it("suppresses consumer-platform login spam", () => {
    expect(isNoiseSignal("Facebook sent a login alert near Johannesburg to your account")).toBe(true);
    expect(isNoiseSignal("Instagram: we noticed a new login")).toBe(true);
  });

  it("suppresses DeanOS's own infrastructure alerts", () => {
    expect(isNoiseSignal("Supabase flagged a critical vulnerability (Row-Level Security is off)")).toBe(true);
    expect(isNoiseSignal("Vercel deployment failed for the DeanOS project")).toBe(true);
    expect(isNoiseSignal("RLS is disabled on the public tables")).toBe(true);
  });

  it("leaves genuine business signals alone", () => {
    expect(isNoiseSignal('Waiting on Lawrence for "signed contract" — 4 business days now')).toBe(false);
    expect(isNoiseSignal('Overdue task (due 2026-07-15): "Research AI automation approach"')).toBe(false);
    expect(isNoiseSignal("High-severity risk still open: client threatening to cancel")).toBe(false);
  });
});

describe("isNoiseEmail (email processor)", () => {
  it("ignores mail from consumer-platform domains", () => {
    expect(isNoiseEmail("security@facebookmail.com", "New login", "")).toBe(true);
    expect(isNoiseEmail("no-reply@mail.instagram.com", "Was this you?", "")).toBe(true);
  });

  it("ignores platform-named login alerts by phrasing", () => {
    expect(
      isNoiseEmail("notifications@facebook.com", "Facebook login alert", "We noticed a new login to your account")
    ).toBe(true);
  });

  it("does not touch real business email", () => {
    expect(isNoiseEmail("lawrence@client.co.za", "Revised proposal", "Here is the contract for signature")).toBe(false);
    // Mentions a platform but is a real work request, not a login/security alert.
    expect(
      isNoiseEmail("mo@heya.team", "LinkedIn campaign", "Can you approve the LinkedIn ad budget for Q3?")
    ).toBe(false);
  });
});
