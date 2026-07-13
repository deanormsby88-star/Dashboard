import { ensureOwner, listCommitments } from "@/lib/db/repo";
import { businessDaysBetween, ESCALATION_BUSINESS_DAYS } from "@/lib/dates";
import { getUpcoming } from "@/lib/calendar/sync";
import { listActiveTodoistTasks } from "@/lib/todoist/api";
import { bucketDueTasks, localToday } from "@/lib/todoist/reminders";
import { wazeLinkFor } from "@/lib/maps";
import { sendToDean } from "@/lib/telegram/notify";

function fmtTime(d: Date): string {
  return new Date(d).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * End-of-day wrap: tomorrow's schedule, what's still on his plate (Todoist due
 * today/overdue), and who to chase — so nothing slips overnight.
 */
export async function sendEndOfDay(now: Date = new Date()): Promise<{ delivered: boolean }> {
  const owner = await ensureOwner();
  const todayStr = localToday(now);
  const tomorrowStr = localToday(new Date(now.getTime() + 86400_000));

  // Tomorrow's timed meetings.
  let tomorrow: string[] = [];
  try {
    const events = await getUpcoming(owner.user.id, 2);
    tomorrow = events
      .filter((e) => !e.all_day && localToday(new Date(e.starts_at)) === tomorrowStr)
      .map((e) => {
        const waze = wazeLinkFor(e.location);
        return `- ${fmtTime(e.starts_at)} · ${e.title}${e.location ? ` @ ${e.location}` : ""}${waze ? `\n   🚗 ${waze}` : ""}`;
      });
  } catch {
    /* no calendar */
  }

  // Still open in Todoist (due today or overdue).
  let openLines: string[] = [];
  try {
    const { overdue, today } = bucketDueTasks(await listActiveTodoistTasks(), todayStr);
    openLines = [...overdue.map((t) => `- ${t.content} (overdue)`), ...today.map((t) => `- ${t.content}`)];
  } catch {
    /* todoist unavailable */
  }

  // Who to chase (waiting on others, escalated).
  const commitments = await listCommitments();
  const chase = commitments
    .filter((c) => c.direction === "to_dean" && c.status === "open")
    .map((c) => ({ c, days: businessDaysBetween(new Date(c.date_made ?? c.created_at), now) }))
    .filter((x) => x.days >= ESCALATION_BUSINESS_DAYS)
    .map((x) => `- ${x.c.text}${x.c.person_name ? ` — ${x.c.person_name}` : ""} (${x.days}d)`);

  const parts = [`🌙 End of day — ${now.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Johannesburg" })}`];
  parts.push(`\n📅 Tomorrow (${tomorrow.length})\n${tomorrow.length ? tomorrow.join("\n") : "Nothing scheduled."}`);
  if (openLines.length) parts.push(`\n✅ Still on your plate (${openLines.length})\n${openLines.join("\n")}`);
  if (chase.length) parts.push(`\n⏳ Chase tomorrow\n${chase.join("\n")}`);

  const delivered = await sendToDean(parts.join("\n"));
  return { delivered };
}
