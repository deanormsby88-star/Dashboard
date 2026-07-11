import { createHmac } from "node:crypto";
import { getEnv } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getCalendarConnection, updateCalendarTokens } from "@/lib/db/repo";
import type { BusinessKey } from "@/lib/types";

const AUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPE = "offline_access openid profile email User.Read Calendars.ReadWrite";

export function redirectUri(): string {
  return `${getEnv().APP_URL}/api/auth/microsoft/callback`;
}

export function isGraphConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET);
}

// ── OAuth state (signed, carries which calendar is being connected) ─────────

export function signState(calendar: BusinessKey): string {
  const body = `${calendar}.${Date.now()}`;
  const sig = createHmac("sha256", getEnv().SESSION_SECRET).update(body).digest("base64url");
  return `${Buffer.from(body).toString("base64url")}.${sig}`;
}

export function verifyState(state: string): BusinessKey | null {
  const [b64, sig] = state.split(".");
  if (!b64 || !sig) return null;
  const body = Buffer.from(b64, "base64url").toString("utf8");
  const expected = createHmac("sha256", getEnv().SESSION_SECRET).update(body).digest("base64url");
  if (sig !== expected) return null;
  const [calendar, ts] = body.split(".");
  if (Date.now() - Number(ts) > 15 * 60 * 1000) return null; // 15-min window
  if (!["heya", "jic", "personal"].includes(calendar)) return null;
  return calendar as BusinessKey;
}

export function authorizeUrl(calendar: BusinessKey): string {
  const env = getEnv();
  const params = new URLSearchParams({
    client_id: env.MS_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: SCOPE,
    state: signState(calendar),
    prompt: "select_account",
  });
  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const env = getEnv();
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID!,
      client_secret: env.MS_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      ...body,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Microsoft token error ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as TokenResponse;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: "authorization_code", code, scope: SCOPE });
}

/** Return a valid access token for a calendar, refreshing (and persisting) if needed. */
export async function getValidAccessToken(userId: string, calendar: BusinessKey): Promise<string | null> {
  const conn = await getCalendarConnection(userId, calendar);
  if (!conn) return null;
  if (conn.expires_at.getTime() - Date.now() > 60_000) {
    return decryptSecret(conn.access_token_enc);
  }
  // Refresh.
  const refreshed = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: decryptSecret(conn.refresh_token_enc),
    scope: SCOPE,
  });
  await updateCalendarTokens({
    userId,
    calendar,
    accessTokenEnc: encryptSecret(refreshed.access_token),
    refreshTokenEnc: encryptSecret(refreshed.refresh_token ?? decryptSecret(conn.refresh_token_enc)),
    expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
  });
  return refreshed.access_token;
}

async function graphFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      Prefer: 'outlook.timezone="UTC"',
      ...init?.headers,
    },
  });
}

export async function getAccountEmail(token: string): Promise<string | null> {
  const res = await graphFetch(token, "/me?$select=mail,userPrincipalName");
  if (!res.ok) return null;
  const me = (await res.json()) as { mail?: string; userPrincipalName?: string };
  return me.mail ?? me.userPrincipalName ?? null;
}

export interface GraphEvent {
  id: string;
  subject: string;
  start: string; // UTC ISO
  end: string | null;
  location: string | null;
  organizer: string | null;
  attendees: string[];
  allDay: boolean;
  webLink: string | null;
}

export async function listEvents(
  token: string,
  fromIso: string,
  toIso: string
): Promise<GraphEvent[]> {
  const q = new URLSearchParams({
    startDateTime: fromIso,
    endDateTime: toIso,
    $select: "id,subject,start,end,location,organizer,attendees,isAllDay,webLink",
    $orderby: "start/dateTime",
    $top: "100",
  });
  const res = await graphFetch(token, `/me/calendarView?${q.toString()}`);
  if (!res.ok) throw new Error(`Graph calendarView ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { value: Array<Record<string, unknown>> };
  return data.value.map((e) => {
    const start = e.start as { dateTime?: string } | undefined;
    const end = e.end as { dateTime?: string } | undefined;
    const loc = e.location as { displayName?: string } | undefined;
    const org = e.organizer as { emailAddress?: { name?: string; address?: string } } | undefined;
    const att = (e.attendees as Array<{ emailAddress?: { name?: string; address?: string } }> | undefined) ?? [];
    return {
      id: String(e.id),
      subject: (e.subject as string) || "(no title)",
      start: toUtcIso(start?.dateTime),
      end: end?.dateTime ? toUtcIso(end.dateTime) : null,
      location: loc?.displayName || null,
      organizer: org?.emailAddress?.name || org?.emailAddress?.address || null,
      attendees: att.map((a) => a.emailAddress?.name || a.emailAddress?.address || "").filter(Boolean),
      allDay: Boolean(e.isAllDay),
      webLink: (e.webLink as string) || null,
    };
  });
}

export interface EventInput {
  subject: string;
  startIso: string; // UTC
  endIso: string; // UTC
  attendees?: string[];
  location?: string | null;
  body?: string | null;
}

export async function createEvent(token: string, input: EventInput): Promise<{ id: string; webLink: string | null }> {
  const res = await graphFetch(token, "/me/events", {
    method: "POST",
    body: JSON.stringify(graphBody(input)),
  });
  if (!res.ok) throw new Error(`Graph create ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const e = (await res.json()) as { id: string; webLink?: string };
  return { id: e.id, webLink: e.webLink ?? null };
}

export async function updateEvent(token: string, eventId: string, input: Partial<EventInput>): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.subject !== undefined) patch.subject = input.subject;
  if (input.location !== undefined) patch.location = { displayName: input.location ?? "" };
  if (input.startIso) patch.start = { dateTime: input.startIso, timeZone: "UTC" };
  if (input.endIso) patch.end = { dateTime: input.endIso, timeZone: "UTC" };
  if (input.attendees) patch.attendees = attendeeList(input.attendees);
  const res = await graphFetch(token, `/me/events/${eventId}`, { method: "PATCH", body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`Graph update ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function deleteEvent(token: string, eventId: string): Promise<void> {
  const res = await graphFetch(token, `/me/events/${eventId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Graph delete ${res.status}`);
}

function graphBody(input: EventInput): Record<string, unknown> {
  return {
    subject: input.subject,
    start: { dateTime: input.startIso, timeZone: "UTC" },
    end: { dateTime: input.endIso, timeZone: "UTC" },
    ...(input.location ? { location: { displayName: input.location } } : {}),
    ...(input.body ? { body: { contentType: "text", content: input.body } } : {}),
    ...(input.attendees && input.attendees.length ? { attendees: attendeeList(input.attendees) } : {}),
  };
}

function attendeeList(emails: string[]): unknown[] {
  return emails.map((address) => ({ emailAddress: { address }, type: "required" }));
}

/** Graph returns naive datetimes (no offset) that ARE UTC given our Prefer header. */
function toUtcIso(dt?: string): string {
  if (!dt) return new Date().toISOString();
  // Already has Z or offset?
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(dt)) return new Date(dt).toISOString();
  return new Date(dt + "Z").toISOString();
}
