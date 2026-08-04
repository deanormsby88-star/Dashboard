import clsx from "clsx";
import { pageUser } from "@/lib/auth/current-user";
import { listZohoTasksForUser, zohoLastSyncedAt } from "@/lib/zoho/scoped";
import { zohoConfigured } from "@/lib/zoho/client";
import EmptyState from "@/components/EmptyState";
import { formatDateTime } from "@/lib/format";
import type { ZohoTask } from "@/lib/zoho/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team — DeanOS" };

function dueLabel(t: ZohoTask): string | null {
  if (!t.dueDate) return null;
  return t.isOverdue && !t.isCompleted ? `Overdue — ${t.dueDate}` : `Due ${t.dueDate}`;
}

function TaskRow({ task }: { task: ZohoTask }) {
  const due = dueLabel(task);
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0 dark:border-white/5">
      <div>
        <p className={clsx("text-sm", task.isCompleted && "text-slate-400 line-through dark:text-slate-500")}>{task.title}</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {task.boardName} · {task.sectionName}
          {task.priorityName !== "None" ? ` · ${task.priorityName}` : ""}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span
          className={clsx(
            "badge",
            task.isCompleted
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : task.isOverdue
                ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          )}
        >
          {task.statusName}
        </span>
        {due && <span className="text-xs text-slate-400 dark:text-slate-500">{due}</span>}
      </div>
    </div>
  );
}

export default async function TeamPage() {
  if (!zohoConfigured()) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-xl font-bold">Team</h1>
        <EmptyState
          title="Zoho Connect not configured"
          description="Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN and ZOHO_SCOPE_ID in the environment to see your team's tasks here."
        />
      </div>
    );
  }

  const owner = await pageUser();
  const [tasks, lastSynced] = await Promise.all([
    listZohoTasksForUser(owner.user.id),
    zohoLastSyncedAt(owner.user.id),
  ]);

  const mine = tasks.filter((t) => t.assignees.some((a) => a.email.toLowerCase() === owner.user.email.toLowerCase()));
  const teamTasks = tasks.filter((t) => !mine.includes(t));

  const byAssignee = new Map<string, ZohoTask[]>();
  for (const t of teamTasks) {
    const names = t.assignees.length ? t.assignees.map((a) => a.name) : ["Unassigned"];
    for (const name of names) byAssignee.set(name, [...(byAssignee.get(name) ?? []), t]);
  }
  const assigneeGroups = [...byAssignee.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const openSort = (a: ZohoTask, b: ZohoTask) => (a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : 1;
  const mineOpen = mine.filter((t) => !t.isCompleted).sort(openSort);
  const mineDone = mine.filter((t) => t.isCompleted);
  const overdueCount = tasks.filter((t) => t.isOverdue && !t.isCompleted).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Team</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Zoho Connect — {tasks.length} tasks{overdueCount ? `, ${overdueCount} overdue` : ""}.
            {lastSynced && ` Synced ${formatDateTime(new Date(lastSynced))}.`}
          </p>
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyState title="No tasks yet" description="Nothing came back from Zoho Connect. Check Settings, or wait for the next sync." />
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              My tasks ({mineOpen.length} open)
            </h2>
            <div className="card divide-y divide-slate-100 px-4 dark:divide-white/5">
              {mineOpen.length === 0 && mineDone.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">Nothing assigned to you.</p>
              ) : (
                [...mineOpen, ...mineDone].map((t) => <TaskRow key={t.id} task={t} />)
              )}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Your team ({teamTasks.filter((t) => !t.isCompleted).length} open)
            </h2>
            <div className="space-y-3">
              {assigneeGroups.map(([name, group]) => {
                const open = group.filter((t) => !t.isCompleted).sort(openSort);
                const done = group.filter((t) => t.isCompleted);
                if (!open.length && !done.length) return null;
                return (
                  <div key={name} className="card px-4">
                    <p className="pt-3 text-sm font-medium">
                      {name} <span className="text-xs font-normal text-slate-400 dark:text-slate-500">({open.length} open)</span>
                    </p>
                    <div className="divide-y divide-slate-100 dark:divide-white/5">
                      {[...open, ...done].map((t) => (
                        <TaskRow key={t.id} task={t} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
