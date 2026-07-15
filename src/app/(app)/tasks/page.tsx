import Link from "next/link";
import clsx from "clsx";
import { ensureOwner, listTasks } from "@/lib/db/repo";
import type { TaskStatus } from "@/lib/types";
import TaskReviewCard from "@/components/TaskReviewCard";
import RepushFailedButton from "@/components/RepushFailedButton";
import MoveToInboxButton from "@/components/MoveToInboxButton";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks — DeanOS" };

const FILTERS: Array<{ label: string; value: TaskStatus | "all" }> = [
  { label: "To review", value: "suggested" },
  { label: "Sent", value: "sent" },
  { label: "In Todoist", value: "created" },
  { label: "Failed", value: "failed" },
  { label: "Rejected", value: "rejected" },
  { label: "All", value: "all" },
];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const filter = (searchParams.status ?? "suggested") as TaskStatus | "all";
  const [owner, tasks] = await Promise.all([
    ensureOwner(),
    listTasks(filter === "all" ? undefined : { status: filter as TaskStatus }),
  ]);
  const businessNameFor = (id: string | null) =>
    owner.businesses.find((b) => b.id === id)?.name ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Tasks</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Extracted and manual tasks. Todoist remains the system of record — approving a task
            sends it straight there.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <RepushFailedButton />
          <MoveToInboxButton />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "suggested" ? "/tasks" : `/tasks?status=${f.value}`}
            className={clsx(
              "rounded-full px-3 py-1 text-sm transition-colors",
              filter === f.value
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description={
            filter === "suggested"
              ? "No tasks are waiting for review. New suggestions appear here after each Circleback meeting is processed."
              : "No tasks match this filter."
          }
        />
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => (
            <TaskReviewCard
              key={t.id}
              task={{
                id: t.id,
                title: t.title,
                description: t.description,
                priority: t.priority,
                due_date: t.due_date ? String(t.due_date).slice(0, 10) : null,
                labels: t.labels,
                origin: t.origin,
                status: t.status,
                status_error: t.status_error,
                confidence: t.confidence,
                todoist_task_url: t.todoist_task_url,
                source_system: t.source_system,
                source_url: t.source_url,
                business: businessNameFor(t.business_id),
                created_at: t.created_at.toISOString(),
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
