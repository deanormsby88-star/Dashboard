import { listCalendarEvents, listCommitments, listPeopleWithCounts, listTasks } from "@/lib/db/repo";
import { allowedSignupDomains, emailDomainAllowed } from "@/lib/env";
import type { Owner } from "@/lib/db/repo";
import type { Commitment, Task } from "@/lib/types";

const TZ = "Africa/Johannesburg";

function ymd(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now); // YYYY-MM-DD
}
function timeLabel(d: Date): string {
  return d.toLocaleTimeString("en-ZA", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
}
function dateLabel(now: Date): string {
  return now.toLocaleDateString("en-ZA", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
}
function dueYMD(due: Date | string | null): string | null {
  if (!due) return null;
  return String(due).slice(0, 10);
}

/**
 * A flat, display-ready snapshot for an external panel (SenseCraft et al.).
 * Every field is a scalar or a pre-formatted multiline string so it binds
 * straight to a widget — no nested arrays to wrangle on the device.
 */
export interface DisplayData {
  updated: string; // "HH:MM"
  date: string; // "Fri 31 Jul"
  headline: string; // one-line summary
  meetings_today: number;
  next_meeting: string;
  schedule: string; // multiline
  tasks_due_today: number;
  tasks: string; // multiline
  you_owe: number;
  team_owes_you: number;
  others_owe_you: number;
  open_loops: number;
  /** One ready-made, laid-out block — bind a single text widget to this. */
  display: string;
}

export async function buildDisplayData(owner: Owner, now: Date = new Date()): Promise<DisplayData> {
  const today = ymd(now);
  const dayStart = new Date(`${today}T00:00:00+02:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);

  const [events, created, sent, suggested, commitments, people] = await Promise.all([
    listCalendarEvents(owner.user.id, dayStart, dayEnd),
    listTasks(owner.user.id, { status: "created" }),
    listTasks(owner.user.id, { status: "sent" }),
    listTasks(owner.user.id, { status: "suggested" }),
    listCommitments(owner.user.id),
    listPeopleWithCounts(owner.user.id),
  ]);

  // ── Today's schedule ──
  const sorted = events.slice().sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const scheduleLines = sorted.map((e) => `${e.all_day ? "All day" : timeLabel(new Date(e.starts_at))} · ${e.title}`);
  const upcoming = sorted.find((e) => new Date(e.starts_at).getTime() >= now.getTime());
  const nextMeeting = upcoming
    ? `${upcoming.all_day ? "Today" : timeLabel(new Date(upcoming.starts_at))} · ${upcoming.title}`
    : sorted.length
      ? "Nothing more today"
      : "No meetings today";

  // ── Tasks due today (or overdue), across everything scheduled ──
  const dueMap = new Map<string, Task>();
  for (const t of [...created, ...sent, ...suggested]) {
    const d = dueYMD(t.due_date);
    if (d && d <= today) dueMap.set(t.id, t);
  }
  const due = [...dueMap.values()].sort((a, b) => (dueYMD(a.due_date)! < dueYMD(b.due_date)! ? -1 : b.priority - a.priority));
  const taskLines = due.slice(0, 8).map((t) => `• ${t.title}`);

  // ── Open loops (accountability) ──
  const open = commitments.filter((c) => c.status === "open");
  const youOwe = open.filter((c) => c.direction === "by_dean").length;
  const domains = (() => {
    const own = owner.user.email.split("@")[1]?.toLowerCase();
    const set = new Set(allowedSignupDomains());
    if (own) set.add(own);
    return [...set];
  })();
  const emailById = new Map(people.map((p) => [p.id, p.email]));
  const emailByName = new Map(people.filter((p) => p.email).map((p) => [p.full_name.toLowerCase(), p.email]));
  const isTeam = (c: Commitment): boolean => {
    const e = (c.person_id && emailById.get(c.person_id)) || (c.person_name && emailByName.get(c.person_name.toLowerCase())) || null;
    return e ? emailDomainAllowed(e, domains) : false;
  };
  const waiting = open.filter((c) => c.direction === "to_dean");
  const teamOwes = waiting.filter(isTeam).length;
  const othersOwe = waiting.length - teamOwes;

  // One pre-formatted block so a single text widget shows the whole panel.
  const display = [
    `DeanOS · ${dateLabel(now)} · ${timeLabel(now)}`,
    ``,
    `📅 TODAY (${sorted.length})`,
    ...(scheduleLines.length ? scheduleLines.slice(0, 5) : ["Nothing scheduled"]),
    ``,
    `✅ DUE TODAY (${due.length})`,
    ...(taskLines.length ? taskLines.slice(0, 5) : ["Nothing due"]),
    ``,
    `⏳ OPEN LOOPS (${open.length})`,
    `You owe ${youOwe} · Team owes you ${teamOwes} · Clients ${othersOwe}`,
  ].join("\n");

  return {
    updated: timeLabel(now),
    date: dateLabel(now),
    headline: `${sorted.length} mtg · ${due.length} due · ${open.length} open`,
    meetings_today: sorted.length,
    next_meeting: nextMeeting,
    schedule: scheduleLines.join("\n") || "No meetings today",
    tasks_due_today: due.length,
    tasks: taskLines.join("\n") || "Nothing due today",
    you_owe: youOwe,
    team_owes_you: teamOwes,
    others_owe_you: othersOwe,
    open_loops: open.length,
    display,
  };
}
