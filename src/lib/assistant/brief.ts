import { buildSnapshot, type StateSnapshot } from "@/lib/assistant/state";
import { runPrioritizer } from "@/lib/assistant/prioritize";
import { ensureOwner, insertBrief, type BriefRow, type CalendarEventRow } from "@/lib/db/repo";
import { getToday } from "@/lib/calendar/sync";
import { wazeLink } from "@/lib/maps";
import { getTodayWeather } from "@/lib/weather";
import { listActiveTodoistTasks } from "@/lib/todoist/api";
import { bucketDueTasks, localToday } from "@/lib/todoist/reminders";

function fmtTime(d: Date): string {
  return new Date(d).toLocaleTimeString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function taskLine(content: string, priority: number, suffix = ""): string {
  const flag = priority >= 4 ? "🔴 " : priority === 3 ? "🟠 " : "";
  return `- ${flag}${content}${suffix}`;
}

function meetingLines(events: CalendarEventRow[]): string {
  return events
    .map((e) => {
      const when = e.all_day ? "All day" : `${fmtTime(e.starts_at)}${e.ends_at ? `–${fmtTime(e.ends_at)}` : ""}`;
      const loc = e.location ? ` @ ${e.location}` : "";
      const nav = e.location ? `\n   🚗 ${wazeLink(e.location)}` : "";
      return `- ${when} · ${e.title}${loc}${nav}`;
    })
    .join("\n");
}

export interface DailyBrief {
  ok: boolean;
  error?: string;
  date: string;
  text: string;
  top3: Array<{ title: string; why: string }>;
  ignoreToday: string[];
  chase: string[];
  recommendation: string | null;
  snapshot: StateSnapshot;
}

/**
 * Generates the executive brief from the current state. Single source of
 * truth for the Assistant `brief` command, the Today dashboard, and the
 * scheduled job. Composes both a human-readable text block and structured
 * fields for the dashboard tiles.
 */
export async function generateDailyBrief(now: Date = new Date()): Promise<DailyBrief> {
  const snapshot = await buildSnapshot(now);
  const result = await runPrioritizer(snapshot);

  // Today's meetings from the calendar (best-effort — brief still works if it fails).
  let meetings: CalendarEventRow[] = [];
  try {
    const owner = await ensureOwner();
    meetings = await getToday(owner.user.id);
  } catch {
    /* no calendar / sync failed — omit the section */
  }

  // Weather (best-effort) and today's Todoist tasks (due today + overdue).
  const weather = await getTodayWeather().catch(() => null);
  let dueTasks: { overdue: Array<{ content: string; priority: number; due: { date: string } | null }>; today: Array<{ content: string; priority: number }> } = {
    overdue: [],
    today: [],
  };
  try {
    const tasks = await listActiveTodoistTasks();
    dueTasks = bucketDueTasks(tasks, localToday(now));
  } catch {
    /* Todoist unavailable — omit the section */
  }

  const escalations = snapshot.waiting_on.filter((w) => w.needs_escalation);
  const top3 = result.ok ? result.output.top_three : [];
  const ignoreToday = result.ok ? result.output.ignore_today : [];
  const chase = result.ok
    ? result.output.chase
    : escalations.map((w) => `${w.text}${w.person ? ` — ${w.person}` : ""}`);
  const recommendation = result.ok ? result.output.recommendation : null;

  // ── Message: 1) Date  2) Weather  3) Calendar  4) Tasks ──────────────────
  const dateLine = now.toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });

  const parts: string[] = [`📋 DAILY BRIEF — ${dateLine}`];

  if (weather) {
    parts.push(
      `\n🌤 Weather\n${weather.summary}, ${weather.tempMin}–${weather.tempMax}°C` +
        `${weather.precipProb ? ` · ${weather.precipProb}% rain` : ""}\n${weather.suggestion}`
    );
  }

  parts.push(
    `\n📅 Calendar (${meetings.length})\n${meetings.length ? meetingLines(meetings) : "Nothing scheduled today."}`
  );

  const taskLines: string[] = [
    ...dueTasks.overdue.map((t) => taskLine(t.content, t.priority, ` — overdue (${t.due?.date ?? "no date"})`)),
    ...dueTasks.today.map((t) => taskLine(t.content, t.priority)),
  ];
  const taskCount = dueTasks.overdue.length + dueTasks.today.length;
  parts.push(`\n✅ Tasks (${taskCount})\n${taskLines.length ? taskLines.join("\n") : "Nothing due today."}`);

  return {
    ok: result.ok,
    error: result.ok ? undefined : result.error,
    date: snapshot.today,
    text: parts.join("\n"),
    top3,
    ignoreToday,
    chase,
    recommendation,
    snapshot,
  };
}

/** Generate and persist a brief (used by the cron job and manual refresh). */
export async function generateAndStoreBrief(source: "manual" | "cron", now: Date = new Date()): Promise<BriefRow> {
  const owner = await ensureOwner();
  const brief = await generateDailyBrief(now);
  return insertBrief({
    userId: owner.user.id,
    generatedFor: brief.date,
    content: brief.text,
    top3: brief.top3,
    ignoreToday: brief.ignoreToday,
    chase: brief.chase,
    recommendation: brief.recommendation,
    source,
  });
}
