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
