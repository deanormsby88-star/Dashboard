import {
  countUnresolvedEmails,
  listCommitments,
  listMeetings,
  listRisks,
  listTasks,
} from "@/lib/db/repo";
import { businessDaysBetween, ESCALATION_BUSINESS_DAYS } from "@/lib/dates";

/**
 * A compact, JSON-serializable snapshot of everything the Assistant's
 * prompts need. Kept deliberately small: titles and one-liners, not bodies.
 */
export interface StateSnapshot {
  today: string;
  tasks_awaiting_review: Array<{ title: string; priority: number; due_date: string | null }>;
  open_tasks_in_todoist: Array<{ title: string; priority: number; due_date: string | null }>;
  waiting_on: Array<{ text: string; person: string | null; business_days_waiting: number; needs_escalation: boolean }>;
  commitments_by_dean: Array<{ text: string; person: string | null; business_days_old: number }>;
  open_risks: Array<{ description: string; severity: string }>;
  recent_meetings: Array<{ title: string; date: string | null; summary: string | null }>;
  unresolved_inbox_items: number;
}

export async function buildSnapshot(now: Date = new Date()): Promise<StateSnapshot> {
  const [suggested, created, commitments, risks, meetings, inboxCount] = await Promise.all([
    listTasks({ status: "suggested" }),
    listTasks({ status: "created" }),
    listCommitments(),
    listRisks(),
    listMeetings(5),
    countUnresolvedEmails(),
  ]);

  const openWaiting = commitments.filter((c) => c.direction === "to_dean" && c.status === "open");
  const openByDean = commitments.filter((c) => c.direction === "by_dean" && c.status === "open");

  return {
    today: now.toISOString().slice(0, 10),
    tasks_awaiting_review: suggested.slice(0, 30).map((t) => ({
      title: t.title,
      priority: t.priority,
      due_date: t.due_date ? String(t.due_date).slice(0, 10) : null,
    })),
    open_tasks_in_todoist: created.slice(0, 30).map((t) => ({
      title: t.title,
      priority: t.priority,
      due_date: t.due_date ? String(t.due_date).slice(0, 10) : null,
    })),
    waiting_on: openWaiting.map((c) => {
      const age = businessDaysBetween(new Date(c.date_made ?? c.created_at), now);
      return {
        text: c.text,
        person: c.person_name,
        business_days_waiting: age,
        needs_escalation: age >= ESCALATION_BUSINESS_DAYS,
      };
    }),
    commitments_by_dean: openByDean.map((c) => ({
      text: c.text,
      person: c.person_name,
      business_days_old: businessDaysBetween(new Date(c.date_made ?? c.created_at), now),
    })),
    open_risks: risks
      .filter((r) => r.status === "open")
      .slice(0, 20)
      .map((r) => ({ description: r.description, severity: r.severity })),
    recent_meetings: meetings.map((m) => ({
      title: m.title,
      date: m.meeting_date ? m.meeting_date.toISOString().slice(0, 10) : null,
      summary: m.summary,
    })),
    unresolved_inbox_items: inboxCount,
  };
}
