import { getEnv } from "@/lib/env";
import { listTasks } from "@/lib/db/repo";
import { getUpcoming } from "@/lib/calendar/sync";
import { localToday } from "@/lib/todoist/reminders";
import { listPendingDeadlines } from "@/lib/deadlines/scan";
import { listPendingChases } from "@/lib/accountability/chase";
import { sendToUser } from "@/lib/telegram/notify";
import type { Owner } from "@/lib/db/repo";

/**
 * End-of-day wrap: ONE message with a link to /review, where everything the
 * tool found today — suggested tasks, detected deadlines, drafted chases —
 * waits in one place for a single approve/decline pass. No individual pushes
 * during the day; this is the one nudge that replaces all of them.
 */
export async function sendEndOfDay(owner: Owner, now: Date = new Date()): Promise<{ delivered: boolean }> {
  const tomorrowStr = localToday(new Date(now.getTime() + 86400_000));

  let tomorrowCount = 0;
  try {
    const events = await getUpcoming(owner.user.id, 2);
    tomorrowCount = events.filter((e) => !e.all_day && localToday(new Date(e.starts_at)) === tomorrowStr).length;
  } catch {
    /* no calendar */
  }

  const [suggestedTasks, pendingDeadlines, pendingChases] = await Promise.all([
    listTasks(owner.user.id, { status: "suggested" }),
    listPendingDeadlines(owner),
    listPendingChases(owner),
  ]);
  const reviewCount = suggestedTasks.length + pendingDeadlines.length + pendingChases.length;

  const dateLine = now.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Johannesburg" });
  const parts = [`🌙 End of day — ${dateLine}`];
  parts.push(`\n📅 Tomorrow: ${tomorrowCount} meeting${tomorrowCount === 1 ? "" : "s"}.`);
  parts.push(
    reviewCount
      ? `📝 ${reviewCount} item${reviewCount === 1 ? "" : "s"} waiting for your review — tasks, deadlines and chase drafts found today.`
      : `📝 Nothing waiting for review — you're all caught up.`
  );
  parts.push(`\n👉 ${getEnv().APP_URL.replace(/\/$/, "")}/review`);

  const delivered = await sendToUser(owner.user.id, parts.join("\n"));
  return { delivered };
}
