import { NextResponse, type NextRequest } from "next/server";
import { getSessionEmail } from "@/lib/auth/require-session";
import { ensureOwner, upsertCalendarConnection } from "@/lib/db/repo";
import { encryptSecret } from "@/lib/crypto";
import { exchangeCode, getAccountEmail, verifyState } from "@/lib/calendar/microsoft";
import { syncCalendar } from "@/lib/calendar/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Microsoft OAuth redirect target: store tokens for the calendar in state. */
export async function GET(request: NextRequest) {
  const email = await getSessionEmail();
  if (!email) return NextResponse.redirect(new URL("/login", request.url));

  const url = request.nextUrl;
  const err = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (err) return NextResponse.redirect(new URL(`/settings?calendar=error`, request.url));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const calendar = state ? verifyState(state) : null;
  if (!code || !calendar) {
    return NextResponse.redirect(new URL("/settings?calendar=bad_state", request.url));
  }

  try {
    const tokens = await exchangeCode(code);
    const account = await getAccountEmail(tokens.access_token);
    const owner = await ensureOwner();
    await upsertCalendarConnection({
      userId: owner.user.id,
      calendar,
      accountEmail: account,
      accessTokenEnc: encryptSecret(tokens.access_token),
      refreshTokenEnc: encryptSecret(tokens.refresh_token),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: tokens.scope ?? null,
    });
    // Prime the cache immediately (best-effort).
    const business = owner.businesses.find((b) => b.key === calendar);
    await syncCalendar(owner.user.id, calendar, business?.id ?? null).catch(() => {});
    return NextResponse.redirect(new URL(`/settings?calendar=connected`, request.url));
  } catch {
    return NextResponse.redirect(new URL(`/settings?calendar=exchange_failed`, request.url));
  }
}
