import { createHmac } from "node:crypto";
import { getEnv } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getCalendarConnection, updateCalendarTokens } from "@/lib/db/repo";
import type { BusinessKey } from "@/lib/types";

const AUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPE = "offline_access openid profile email User.Read Calendars.ReadWrite Mail.ReadWrite Mail.Send";

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

// ── Mail ────────────────────────────────────────────────────────────────────

export interface GraphMessage {
  id: string;
  subject: string;
  from: string;
  fromAddress: string | null;
  receivedIso: string;
  preview: string;
  webLink: string | null;
}

const MAIL_SELECT = "id,subject,from,receivedDateTime,bodyPreview,webLink";

function mapMessage(m: Record<string, unknown>): GraphMessage {
  const from = m.from as { emailAddress?: { name?: string; address?: string } } | undefined;
  return {
    id: String(m.id),
    subject: (m.subject as string) || "(no subject)",
    from: from?.emailAddress?.name || from?.emailAddress?.address || "(unknown)",
    fromAddress: from?.emailAddress?.address ?? null,
    receivedIso: (m.receivedDateTime as string) ?? "",
    preview: ((m.bodyPreview as string) || "").slice(0, 300),
    webLink: (m.webLink as string) || null,
  };
}

/**
 * Search a mailbox. With `query`, does a full-text $search (relevance order);
 * otherwise lists recent mail, optionally since `sinceIso`, newest first.
 */
export async function searchMessages(
  token: string,
  opts: { query?: string; sinceIso?: string; top?: number }
): Promise<GraphMessage[]> {
  const top = String(opts.top ?? 15);
  let path: string;
  if (opts.query && opts.query.trim()) {
    const q = encodeURIComponent(`"${opts.query.replace(/"/g, "")}"`);
    path = `/me/messages?$search=${q}&$select=${MAIL_SELECT}&$top=${top}`;
  } else {
    const filter = opts.sinceIso ? `&$filter=${encodeURIComponent(`receivedDateTime ge ${opts.sinceIso}`)}` : "";
    path = `/me/messages?$select=${MAIL_SELECT}&$orderby=receivedDateTime%20desc&$top=${top}${filter}`;
  }
  const res = await graphFetch(token, path);
  if (!res.ok) throw new Error(`Graph mail search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { value?: Array<Record<string, unknown>> };
  return (data.value ?? []).map(mapMessage);
}

export interface SentMessage {
  id: string;
  conversationId: string;
  subject: string;
  to: string[];
  sentIso: string;
}

/** Dean's recent sent mail (for awaiting-reply detection). */
export async function listSentMessages(token: string, sinceIso: string, top = 40): Promise<SentMessage[]> {
  const q = new URLSearchParams({
    $select: "id,conversationId,subject,toRecipients,sentDateTime",
    $orderby: "sentDateTime desc",
    $top: String(top),
    $filter: `sentDateTime ge ${sinceIso}`,
  });
  const res = await graphFetch(token, `/me/mailFolders/sentitems/messages?${q.toString()}`);
  if (!res.ok) throw new Error(`Graph sent items ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { value?: Array<Record<string, unknown>> };
  return (data.value ?? []).map((m) => {
    const to = (m.toRecipients as Array<{ emailAddress?: { name?: string; address?: string } }> | undefined) ?? [];
    return {
      id: String(m.id),
      conversationId: String(m.conversationId ?? ""),
      subject: (m.subject as string) || "(no subject)",
      to: to.map((r) => r.emailAddress?.name || r.emailAddress?.address || "").filter(Boolean),
      sentIso: (m.sentDateTime as string) ?? "",
    };
  });
}

/** Recent inbox messages (for triage). */
export async function listInboxMessages(
  token: string,
  sinceIso: string,
  opts: { unreadOnly?: boolean; top?: number } = {}
): Promise<GraphMessage[]> {
  const filters = [`receivedDateTime ge ${sinceIso}`];
  if (opts.unreadOnly) filters.push("isRead eq false");
  const q = new URLSearchParams({
    $select: MAIL_SELECT,
    $orderby: "receivedDateTime desc",
    $top: String(opts.top ?? 25),
    $filter: filters.join(" and "),
  });
  const res = await graphFetch(token, `/me/mailFolders/inbox/messages?${q.toString()}`);
  if (!res.ok) throw new Error(`Graph inbox ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { value?: Array<Record<string, unknown>> };
  return (data.value ?? []).map(mapMessage);
}

/** The most recent message in a conversation: who it's from and when. */
export async function latestInConversation(
  token: string,
  conversationId: string
): Promise<{ fromAddress: string | null; receivedIso: string } | null> {
  const q = new URLSearchParams({
    $filter: `conversationId eq '${conversationId}'`,
    $select: "from,receivedDateTime",
    $orderby: "receivedDateTime desc",
    $top: "1",
  });
  const res = await graphFetch(token, `/me/messages?${q.toString()}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { value?: Array<Record<string, unknown>> };
  const m = data.value?.[0];
  if (!m) return null;
  const from = m.from as { emailAddress?: { address?: string } } | undefined;
  return { fromAddress: from?.emailAddress?.address ?? null, receivedIso: (m.receivedDateTime as string) ?? "" };
}

/** Full plain-text body of a single message. */
export async function getMessageBody(token: string, messageId: string): Promise<{ subject: string; from: string; body: string } | null> {
  const res = await graphFetch(token, `/me/messages/${messageId}?$select=subject,from,body`);
  if (!res.ok) return null;
  const m = (await res.json()) as {
    subject?: string;
    from?: { emailAddress?: { name?: string; address?: string } };
    body?: { contentType?: string; content?: string };
  };
  let body = m.body?.content ?? "";
  if (m.body?.contentType === "html") body = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return {
    subject: m.subject ?? "",
    from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "",
    body: body.slice(0, 6000),
  };
}

/**
 * Reply (threaded) to a message. With `html`, sends an HTML reply that keeps
 * the quoted original: create a reply draft, prepend our HTML above the quote,
 * then send. Otherwise a plain-text reply via the reply action.
 */
/** File attachments (with base64 bytes) on a message. */
export async function getMessageAttachments(
  token: string,
  messageId: string
): Promise<Array<{ name: string; contentType: string; contentBytes: string }>> {
  const res = await graphFetch(token, `/me/messages/${messageId}/attachments?$select=name,contentType,contentBytes`);
  if (!res.ok) return [];
  const data = (await res.json()) as { value?: Array<Record<string, unknown>> };
  return (data.value ?? [])
    .filter((a) => typeof a.contentBytes === "string")
    .map((a) => ({
      name: String(a.name ?? "attachment"),
      contentType: String(a.contentType ?? "application/octet-stream"),
      contentBytes: String(a.contentBytes),
    }));
}

export async function replyToMessage(
  token: string,
  messageId: string,
  body: string,
  html?: string,
  attachments?: unknown[]
): Promise<void> {
  if (html) {
    const cr = await graphFetch(token, `/me/messages/${messageId}/createReply`, { method: "POST" });
    if (!cr.ok) throw new Error(`Graph createReply ${cr.status}: ${(await cr.text()).slice(0, 200)}`);
    const draft = (await cr.json()) as { id: string; body?: { content?: string } };
    const quoted = draft.body?.content ?? "";
    // Add inline attachments (e.g. the logo) to the draft before sending.
    for (const att of attachments ?? []) {
      const a = await graphFetch(token, `/me/messages/${draft.id}/attachments`, {
        method: "POST",
        body: JSON.stringify(att),
      });
      if (!a.ok) throw new Error(`Graph add attachment ${a.status}: ${(await a.text()).slice(0, 200)}`);
    }
    const patch = await graphFetch(token, `/me/messages/${draft.id}`, {
      method: "PATCH",
      body: JSON.stringify({ body: { contentType: "HTML", content: `${html}${quoted}` } }),
    });
    if (!patch.ok) throw new Error(`Graph patch reply ${patch.status}: ${(await patch.text()).slice(0, 200)}`);
    const send = await graphFetch(token, `/me/messages/${draft.id}/send`, { method: "POST" });
    if (!send.ok) throw new Error(`Graph send reply ${send.status}: ${(await send.text()).slice(0, 200)}`);
    return;
  }
  const res = await graphFetch(token, `/me/messages/${messageId}/reply`, {
    method: "POST",
    body: JSON.stringify({ comment: body }),
  });
  if (!res.ok) throw new Error(`Graph reply ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Send a brand-new email. Pass `html` for an HTML body, `attachments` for inline images/files. */
export async function sendNewMessage(
  token: string,
  input: { to: string[]; subject: string; body: string; html?: string; attachments?: unknown[] }
): Promise<void> {
  const message: Record<string, unknown> = {
    subject: input.subject,
    body: input.html ? { contentType: "HTML", content: input.html } : { contentType: "text", content: input.body },
    toRecipients: input.to.map((address) => ({ emailAddress: { address } })),
  };
  if (input.attachments && input.attachments.length) message.attachments = input.attachments;
  const res = await graphFetch(token, "/me/sendMail", {
    method: "POST",
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!res.ok) throw new Error(`Graph sendMail ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Graph returns naive datetimes (no offset) that ARE UTC given our Prefer header. */
function toUtcIso(dt?: string): string {
  if (!dt) return new Date().toISOString();
  // Already has Z or offset?
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(dt)) return new Date(dt).toISOString();
  return new Date(dt + "Z").toISOString();
}
