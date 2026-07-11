import { buildSnapshot, type StateSnapshot } from "@/lib/assistant/state";
import { runPrioritizer, formatTop3 } from "@/lib/assistant/prioritize";
import { ensureOwner, insertBrief, type BriefRow, type CalendarEventRow } from "@/lib/db/repo";
import { getToday } from "@/lib/calendar/sync";
import { wazeLink } from "@/lib/maps";

function fmtTime(d: Date): string {
  return new Date(d).toLocaleTimeString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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

  const escalations = snapshot.waiting_on.filter((w) => w.needs_escalation);
  const top3 = result.ok ? result.output.top_three : [];
  const ignoreToday = result.ok ? result.output.ignore_today : [];
  const chase = result.ok
    ? result.output.chase
    : escalations.map((w) => `${w.text}${w.person ? ` — ${w.person}` : ""}`);
  const recommendation = result.ok ? result.output.recommendation : null;

  const parts: string[] = [`EXECUTIVE BRIEF — ${snapshot.today}`];
  if (meetings.length > 0) parts.push(`\nToday's meetings (${meetings.length}):\n${meetingLines(meetings)}`);
  if (result.ok && top3.length > 0) parts.push(`\nTop 3:\n${formatTop3(result.output)}`);
  if (chase.length > 0) parts.push(`\nChase today:\n${chase.map((s) => `- ${s}`).join("\n")}`);
  if (escalations.length > 0)
    parts.push(
      `\nOverdue (waiting on others):\n${escalations
        .map((w) => `- ${w.text}${w.person ? ` — ${w.person}` : ""} (${w.business_days_waiting} business days)`)
        .join("\n")}`
    );
  if (snapshot.open_risks.length > 0)
    parts.push(`\nRisks:\n${snapshot.open_risks.map((r) => `- [${r.severity}] ${r.description}`).join("\n")}`);
  const queued: string[] = [];
  if (snapshot.tasks_awaiting_review.length > 0)
    queued.push(`${snapshot.tasks_awaiting_review.length} task suggestion(s) to review`);
  if (snapshot.unresolved_inbox_items > 0) queued.push(`${snapshot.unresolved_inbox_items} inbox item(s)`);
  if (queued.length > 0) parts.push(`\nQueue: ${queued.join(", ")}.`);
  if (recommendation) parts.push(`\n${recommendation}`);
  if (!result.ok) parts.push(`\n(Prioritizer unavailable: ${result.error})`);

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
