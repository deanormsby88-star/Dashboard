import { listTasks } from "@/lib/db/repo";
import { pageUser } from "@/lib/auth/current-user";
import { listPendingDeadlines } from "@/lib/deadlines/scan";
import { listPendingChases } from "@/lib/accountability/chase";
import TaskReviewCard from "@/components/TaskReviewCard";
import DeadlineReviewCard from "@/components/DeadlineReviewCard";
import ChaseReviewCard from "@/components/ChaseReviewCard";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review — DeanOS" };

export default async function ReviewPage() {
  const owner = await pageUser();
  const businessNameFor = (id: string | null) => owner.businesses.find((b) => b.id === id)?.name ?? null;

  const [tasks, deadlines, chases] = await Promise.all([
    listTasks(owner.user.id, { status: "suggested" }),
    listPendingDeadlines(owner),
    listPendingChases(owner),
  ]);

  const total = tasks.length + deadlines.length + chases.length;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-xl font-bold">Review</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Everything DeanOS found today, in one place — approve or decline it here instead of a stream of
          messages.
        </p>
      </div>

      {total === 0 ? (
        <EmptyState title="All caught up" description="Nothing is waiting for review right now." />
      ) : (
        <>
          {tasks.length > 0 && (
            <section className="space-y-3">
              <h2 className="eyebrow">Tasks ({tasks.length})</h2>
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
            </section>
          )}

          {deadlines.length > 0 && (
            <section className="space-y-3">
              <h2 className="eyebrow">Deadlines spotted ({deadlines.length})</h2>
              <div className="space-y-3">
                {deadlines.map((d) => (
                  <DeadlineReviewCard key={d.id} deadline={{ id: d.id, what: d.what, dueLabel: d.dueLabel, source: d.source, rungCount: d.rungs.length }} />
                ))}
              </div>
            </section>
          )}

          {chases.length > 0 && (
            <section className="space-y-3">
              <h2 className="eyebrow">Drafted chases &amp; check-ins ({chases.length})</h2>
              <div className="space-y-3">
                {chases.map((c) => (
                  <ChaseReviewCard key={c.id} chase={{ id: c.id, personName: c.personName, draft: c.draft, subject: c.subject }} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
