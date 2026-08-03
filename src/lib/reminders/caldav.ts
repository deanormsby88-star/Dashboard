import { createDAVClient } from "tsdav";

/**
 * Apple Reminders over iCloud CalDAV. Reminders are VTODO items living in
 * "calendars" that support the VTODO component. We connect with an Apple ID +
 * app-specific password (never the main password). Step 1 covers connect +
 * list discovery; read/write of todos land in later steps.
 */

const ICLOUD = "https://caldav.icloud.com";

export interface ReminderList {
  displayName: string;
  url: string;
}

type Dav = Awaited<ReturnType<typeof createDAVClient>>;

async function connect(username: string, password: string): Promise<Dav> {
  return createDAVClient({
    serverUrl: ICLOUD,
    credentials: { username, password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
}

function isTodoCalendar(c: { components?: string[] | null }): boolean {
  return (c.components ?? []).map((x) => String(x).toUpperCase()).includes("VTODO");
}

/**
 * Verify credentials and return the account's Reminders lists (VTODO
 * calendars). Throws if sign-in fails so the caller can surface a clear error.
 */
export async function listReminderLists(username: string, password: string): Promise<ReminderList[]> {
  const dav = await connect(username, password);
  const calendars = await dav.fetchCalendars();
  return calendars.filter(isTodoCalendar).map((c) => ({
    displayName:
      typeof c.displayName === "string" && c.displayName.trim() ? c.displayName : "Reminders",
    url: c.url,
  }));
}

export interface ReminderTodo {
  uid: string;
  title: string; // #tags stripped out
  dueDate: string | null; // YYYY-MM-DD
  completed: boolean;
  priority: number | null; // 1 (high) … 9 (low), Apple maps to !!!/!!/!
  tags: string[]; // e.g. ["heya"]
  url: string; // object URL (for later update/complete)
}

// ── iCalendar (VTODO) parsing ────────────────────────────────────────────────

function unfold(s: string): string {
  return s.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}
function unescape(s: string): string {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}
function prop(block: string, name: string): string | null {
  const m = new RegExp(`^${name}(;[^:\\r\\n]*)?:(.*)$`, "im").exec(block);
  return m ? m[2].trim() : null;
}
function toYMD(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "").slice(0, 8);
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : null;
}

/** Parse the VTODO items out of a raw iCalendar string. */
export function parseVTodos(data: string, url: string): ReminderTodo[] {
  const text = unfold(data);
  const out: ReminderTodo[] = [];
  for (const m of text.matchAll(/BEGIN:VTODO([\s\S]*?)END:VTODO/g)) {
    const block = m[1];
    const summary = unescape(prop(block, "SUMMARY") ?? "").trim();
    if (!summary) continue;
    const status = (prop(block, "STATUS") ?? "").toUpperCase();
    const tags = [...summary.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((t) => t[1]);
    const priorityRaw = prop(block, "PRIORITY");
    out.push({
      uid: prop(block, "UID") ?? "",
      title: summary.replace(/\s*#[\p{L}\p{N}_-]+/gu, "").trim() || summary,
      dueDate: toYMD(prop(block, "DUE")),
      completed: status === "COMPLETED",
      priority: priorityRaw && /^\d+$/.test(priorityRaw) ? Number(priorityRaw) : null,
      tags,
      url,
    });
  }
  return out;
}

/** Fetch todos from a specific Reminders list. `includeCompleted` off by default. */
export async function listReminderTodos(
  username: string,
  password: string,
  listUrl: string,
  includeCompleted = false
): Promise<ReminderTodo[]> {
  const dav = await connect(username, password);
  const objects = await dav.fetchCalendarObjects({ calendar: { url: listUrl } as never });
  const todos = objects.flatMap((o) => parseVTodos(String(o.data ?? ""), o.url));
  return includeCompleted ? todos : todos.filter((t) => !t.completed);
}
