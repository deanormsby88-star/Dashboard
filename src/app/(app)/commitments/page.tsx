import { listCommitments } from "@/lib/db/repo";
import { ConfidenceBadge, StatusBadge } from "@/components/badges";
import EmptyState from "@/components/EmptyState";
import { formatDate } from "@/lib/format";
import type { Commitment } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Commitments — DeanOS" };

function CommitmentList({ items, emptyText }: { items: Commitment[]; emptyText: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{emptyText}</p>;
  }
  return (
    <div className="space-y-3">
      {items.map((c) => (
        <div key={c.id} className="card p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p>{c.text}</p>
            <StatusBadge status={c.status} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
            {c.person_name && <span>{c.direction === "by_dean" ? "to" : "from"} {c.person_name}</span>}
            {c.date_made && <span>made {formatDate(c.date_made)}</span>}
            {c.due_date && <span>due {formatDate(c.due_date)}</span>}
            {c.source_system && <span>source: {c.source_system}</span>}
            <ConfidenceBadge confidence={c.confidence} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function CommitmentsPage() {
  const commitments = await listCommitments();
  const byDean = commitments.filter((c) => c.direction === "by_dean");
  const toDean = commitments.filter((c) => c.direction === "to_dean");

  if (commitments.length === 0) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-xl font-bold">Commitments</h1>
        <EmptyState
          title="No commitments tracked yet"
          description="Commitments Dean makes in meetings — and things others promise to Dean — are extracted automatically when Circleback meetings are processed."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Commitments</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Both directions: what Dean promised, and what others owe Dean.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            By Dean ({byDean.length})
          </h2>
          <CommitmentList items={byDean} emptyText="No commitments made by Dean." />
        </section>
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            To Dean / waiting on ({toDean.length})
          </h2>
          <CommitmentList items={toDean} emptyText="Nobody owes Dean anything right now." />
        </section>
      </div>
    </div>
  );
}
