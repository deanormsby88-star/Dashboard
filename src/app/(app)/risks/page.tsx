import { listRisks } from "@/lib/db/repo";
import { ConfidenceBadge, SeverityBadge, StatusBadge } from "@/components/badges";
import EmptyState from "@/components/EmptyState";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Risks — DeanOS" };

export default async function RisksPage() {
  const risks = await listRisks();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Risks</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Material risks surfaced from meetings, ordered newest first.
        </p>
      </div>
      {risks.length === 0 ? (
        <EmptyState
          title="No risks tracked"
          description="Operational, client, people, financial, legal and technical risks raised in meetings will appear here after processing."
        />
      ) : (
        <div className="space-y-3">
          {risks.map((r) => (
            <div key={r.id} className="card p-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p>{r.description}</p>
                <StatusBadge status={r.status} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                <SeverityBadge severity={r.severity} />
                <ConfidenceBadge confidence={r.confidence} />
                <span>{formatDateTime(r.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
