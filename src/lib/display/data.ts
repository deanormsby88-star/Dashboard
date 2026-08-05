import { listCalendarEvents, listCommitments, listPeopleWithCounts } from "@/lib/db/repo";
import { allowedSignupDomains, emailDomainAllowed } from "@/lib/env";
import { getWeather, weatherLine } from "@/lib/display/weather";
import { getCachedGarminSnapshot } from "@/lib/garmin/sync";
import { listTodoistTasksForUser } from "@/lib/todoist/scoped";
import { businessDaysStale } from "@/lib/accountability/staleness";
import { shiftYMD } from "@/lib/deadlines/ladder";
import type { Owner } from "@/lib/db/repo";
import type { Commitment } from "@/lib/types";

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
/** "2026-08-05" → "5 Aug" (SAST); "" for no date. */
function dueShort(date: string | undefined | null): string {
  if (!date) return "";
  const d = new Date(`${date.slice(0, 10)}T12:00:00+02:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-ZA", { timeZone: TZ, day: "numeric", month: "short" });
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
  weather: string; // "Partly cloudy · 14° · H 24° L 11°" (empty if unavailable)
  weather_place: string;
  weather_now: string; // "14°" (empty if unavailable)
  all_tasks: string; // multiline "content · 5 Aug" — every active Todoist task
  all_tasks_total: number;
  health: string; // "Sleep 7.1h · RHR 79 · Steps 4,400" (empty if no Garmin)
  chase: string; // multiline "Person — item (Nd)" — stalest owed-to-you
  /** One ready-made, laid-out block — bind a single text widget to this. */
  display: string;
}

export interface DisplayOptions {
  lat?: number;
  lon?: number;
  place?: string;
}

export async function buildDisplayData(owner: Owner, now: Date = new Date(), opts: DisplayOptions = {}): Promise<DisplayData> {
  const today = ymd(now);
  const dayStart = new Date(`${today}T00:00:00+02:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);

  const [events, commitments, people, weather, todoist, garmin] = await Promise.all([
    listCalendarEvents(owner.user.id, dayStart, dayEnd),
    listCommitments(owner.user.id),
    listPeopleWithCounts(owner.user.id),
    getWeather(opts.lat, opts.lon, opts.place),
    listTodoistTasksForUser(owner.user.id),
    getCachedGarminSnapshot(owner.user.id),
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

  // ── Tasks due today (or overdue) — live from Todoist ──
  const due = todoist
    .filter((t) => t.due?.date && t.due.date <= today)
    .sort((a, b) => (a.due!.date < b.due!.date ? -1 : b.priority - a.priority));
  const taskLines = due.slice(0, 8).map((t) => `• ${t.content}`);

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

  const weatherStr = weatherLine(weather);

  // ── Health (cached Garmin snapshot) ──
  const healthParts: string[] = [];
  if (garmin) {
    if (garmin.sleepHours != null) healthParts.push(`Sleep ${garmin.sleepHours}h`);
    if (garmin.bodyBattery != null) healthParts.push(`Body ${garmin.bodyBattery}`);
    if (garmin.stress != null) healthParts.push(`Stress ${garmin.stress}`);
    if (garmin.restingHr != null) healthParts.push(`RHR ${garmin.restingHr}`);
    if (garmin.steps != null) healthParts.push(`Steps ${garmin.steps.toLocaleString("en-ZA")}`);
  }
  const healthStr = healthParts.join(" · ");

  // ── All Todoist tasks with due dates (dated first, soonest → latest) ──
  const FAR = "9999-12-31";
  const todoistSorted = todoist
    .slice()
    .sort((a, b) => (a.due?.date ?? FAR).localeCompare(b.due?.date ?? FAR) || b.priority - a.priority);
  const todoistLines = todoistSorted.map((t) => {
    const due = dueShort(t.due?.date);
    return due ? `${t.content} · ${due}` : t.content;
  });

  // ── Needs chasing: stalest things owed to Dean, by name ──
  const chaseLines = waiting
    .map((c) => ({ c, age: businessDaysStale(c, now) }))
    .sort((a, b) => b.age - a.age)
    .slice(0, 3)
    .map(({ c, age }) => `${c.person_name ?? "Someone"} — ${c.text} (${age}d)`);

  // One pre-formatted block so a single text widget shows the whole panel.
  const display = [
    `DeanOS · ${dateLabel(now)} · ${timeLabel(now)}`,
    ...(weatherStr ? [`${weather!.place}: ${weatherStr}`] : []),
    ...(healthStr ? [`❤ ${healthStr}`] : []),
    ``,
    `📅 TODAY (${sorted.length})`,
    ...(scheduleLines.length ? scheduleLines.slice(0, 4) : ["Nothing scheduled"]),
    ``,
    `✅ TASKS (${todoistLines.length})`,
    ...(todoistLines.length ? todoistLines.slice(0, 10) : ["No tasks"]),
    ``,
    `📨 CHASE`,
    ...(chaseLines.length ? chaseLines : ["Nobody owes you anything"]),
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
    weather: weatherStr,
    weather_place: weather?.place ?? "",
    weather_now: weather ? `${weather.now}°` : "",
    all_tasks: todoistLines.join("\n"),
    all_tasks_total: todoistLines.length,
    health: healthStr,
    chase: chaseLines.join("\n"),
    display,
  };
}

// ── Week calendar (unified, Monday–Sunday, time-grid) ───────────────────────

/** Minutes since SAST midnight, using the fixed UTC+2 offset (no DST). */
function minutesSAST(d: Date): number {
  const shifted = new Date(d.getTime() + 2 * 3600_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export interface WeekGridEvent {
  title: string;
  startMin: number; // minutes since midnight, SAST
  endMin: number; // clamped to <=1440 (same-day)
  lane: number; // 0-based column within the day when events overlap
  lanes: number; // total concurrent lanes for this event's overlap group
}

export interface WeekCalendarDay {
  dayName: string; // "Mon"
  dayLabel: string; // "4 Aug"
  isToday: boolean;
  allDay: string[]; // all-day event titles
  timed: WeekGridEvent[];
}

export interface WeekCalendarData {
  rangeLabel: string; // "4 – 10 Aug 2026"
  updated: string;
  hourStart: number; // first hour shown on the grid
  hourEnd: number; // last hour shown (exclusive)
  days: WeekCalendarDay[];
}

/** Greedy lane-packing so overlapping events sit side-by-side, like a normal calendar. */
export function packLanes(events: Array<{ title: string; startMin: number; endMin: number }>): WeekGridEvent[] {
  const sorted = events.slice().sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const laneEnds: number[] = []; // laneEnds[i] = when lane i is next free
  const placed: Array<WeekGridEvent & { groupId: number }> = [];
  let groupId = 0;
  let groupEnd = -1;

  for (const e of sorted) {
    if (e.startMin >= groupEnd) {
      groupId++;
      laneEnds.length = 0;
      groupEnd = -1;
    }
    let lane = laneEnds.findIndex((end) => end <= e.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e.endMin);
    } else {
      laneEnds[lane] = e.endMin;
    }
    groupEnd = Math.max(groupEnd, e.endMin);
    placed.push({ ...e, lane, lanes: 1, groupId });
  }

  // Second pass: each event's `lanes` = max concurrent lanes within its overlap group.
  const lanesByGroup = new Map<number, number>();
  for (const p of placed) lanesByGroup.set(p.groupId, Math.max(lanesByGroup.get(p.groupId) ?? 1, p.lane + 1));
  return placed.map(({ groupId, ...p }) => ({ ...p, lanes: lanesByGroup.get(groupId) ?? 1 }));
}

export async function buildWeekCalendarData(owner: Owner, now: Date = new Date()): Promise<WeekCalendarData> {
  const today = ymd(now);
  const dow = new Date(`${today}T12:00:00+02:00`).getUTCDay(); // 0=Sun..6=Sat
  const monday = shiftYMD(today, -((dow + 6) % 7));
  const dayYMDs = Array.from({ length: 7 }, (_, i) => shiftYMD(monday, i));

  const weekStart = new Date(`${dayYMDs[0]}T00:00:00+02:00`);
  const weekEnd = new Date(`${dayYMDs[6]}T00:00:00+02:00`).getTime() + 24 * 3600_000;
  const events = await listCalendarEvents(owner.user.id, weekStart, new Date(weekEnd));

  const allDayByDay = new Map<string, string[]>();
  const timedByDay = new Map<string, Array<{ title: string; startMin: number; endMin: number }>>();
  let minHour = 24;
  let maxHour = 0;

  for (const e of events) {
    const key = ymd(new Date(e.starts_at));
    if (e.all_day) {
      allDayByDay.set(key, [...(allDayByDay.get(key) ?? []), e.title]);
      continue;
    }
    const startMin = minutesSAST(new Date(e.starts_at));
    const endMin = Math.max(startMin + 15, e.ends_at ? Math.min(1440, minutesSAST(new Date(e.ends_at))) : startMin + 30);
    timedByDay.set(key, [...(timedByDay.get(key) ?? []), { title: e.title, startMin, endMin }]);
    minHour = Math.min(minHour, Math.floor(startMin / 60));
    maxHour = Math.max(maxHour, Math.ceil(endMin / 60));
  }

  // Business-hours default, widened automatically if events fall outside it.
  const hourStart = Math.max(0, Math.min(7, minHour === 24 ? 7 : minHour));
  const hourEnd = Math.min(23, Math.max(18, maxHour === 0 ? 18 : maxHour));

  const days: WeekCalendarDay[] = dayYMDs.map((d) => {
    const at = new Date(`${d}T12:00:00+02:00`);
    return {
      dayName: at.toLocaleDateString("en-ZA", { timeZone: TZ, weekday: "short" }),
      dayLabel: at.toLocaleDateString("en-ZA", { timeZone: TZ, day: "numeric", month: "short" }),
      isToday: d === today,
      allDay: allDayByDay.get(d) ?? [],
      timed: packLanes(timedByDay.get(d) ?? []),
    };
  });

  const mondayAt = new Date(`${dayYMDs[0]}T12:00:00+02:00`);
  const sundayAt = new Date(`${dayYMDs[6]}T12:00:00+02:00`);
  const rangeLabel = `${mondayAt.toLocaleDateString("en-ZA", { timeZone: TZ, day: "numeric" })} – ${sundayAt.toLocaleDateString("en-ZA", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" })}`;

  return { rangeLabel, updated: timeLabel(now), hourStart, hourEnd, days };
}
