import { NextResponse, type NextRequest } from "next/server";
import { getEnv, isAllowedSignupEmail } from "@/lib/env";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { ensureUser, getUserByEmail, upsertCalendarConnection } from "@/lib/db/repo";
import { encryptSecret } from "@/lib/crypto";
import {
  exchangeCode,
  getAccountEmail,
  getAccountProfile,
  verifyState,
} from "@/lib/calendar/microsoft";
import { syncCalendar } from "@/lib/calendar/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Single Microsoft OAuth redirect target for two intents:
 *  - login:   sign in with Microsoft → create/resolve the user, connect their
 *             primary calendar, and set the session cookie.
 *  - connect: an already-logged-in user connected a specific calendar (the
 *             state binds which user initiated it).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const err = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (err) return NextResponse.redirect(new URL(`/login?error=oauth`, request.url));

  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const state = stateRaw ? verifyState(stateRaw) : null;
  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=bad_state", request.url));
  }

  // ── Sign in with Microsoft ────────────────────────────────────────────────
  if (state.intent === "login") {
    try {
      const tokens = await exchangeCode(code);
      const profile = await getAccountProfile(tokens.access_token);
      if (!profile) return NextResponse.redirect(new URL("/login?error=profile", request.url));

      // The domain allow-list gates NEW sign-ups only; an existing user (e.g.
      // the original owner) can always sign in regardless of the current list.
      const existing = await getUserByEmail(profile.email);
      if (!existing && !isAllowedSignupEmail(profile.email)) {
        return NextResponse.redirect(new URL("/login?error=domain", request.url));
      }

      const owner = await ensureUser({
        email: profile.email,
        name: profile.name,
        microsoftOid: profile.oid,
      });

      // Back the user's primary context with this Microsoft account so calendar
      // and email work immediately.
      const primary = owner.businesses[0]?.key ?? "work";
      await upsertCalendarConnection({
        userId: owner.user.id,
        calendar: primary,
        accountEmail: profile.email,
        accessTokenEnc: encryptSecret(tokens.access_token),
        refreshTokenEnc: encryptSecret(tokens.refresh_token),
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scope: tokens.scope ?? null,
      });
      await syncCalendar(owner.user.id, primary, owner.businesses[0]?.id ?? null).catch(() => {});

      const token = await createSessionToken(owner.user.id, owner.user.email, getEnv().SESSION_SECRET);
      const dest = owner.user.setup_completed_at ? "/" : "/setup";
      const response = NextResponse.redirect(new URL(dest, request.url));
      response.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: getEnv().APP_URL.startsWith("https://"),
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
      });
      return response;
    } catch {
      return NextResponse.redirect(new URL("/login?error=exchange_failed", request.url));
    }
  }

  // ── Connect a calendar for the already-logged-in user (bound in state) ─────
  try {
    const tokens = await exchangeCode(code);
    const account = await getAccountEmail(tokens.access_token);
    await upsertCalendarConnection({
      userId: state.userId,
      calendar: state.calendar,
      accountEmail: account,
      accessTokenEnc: encryptSecret(tokens.access_token),
      refreshTokenEnc: encryptSecret(tokens.refresh_token),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: tokens.scope ?? null,
    });
    await syncCalendar(state.userId, state.calendar, null).catch(() => {});
    return NextResponse.redirect(new URL(`/settings?calendar=connected`, request.url));
  } catch {
    return NextResponse.redirect(new URL(`/settings?calendar=exchange_failed`, request.url));
  }
}
