import { listPeople } from "@/lib/db/repo";
import EmptyState from "@/components/EmptyState";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "People — DeanOS" };

export default async function PeoplePage() {
  const people = await listPeople();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">People</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          People mentioned in commitments and relationship updates. Full relationship
          intelligence (profiles, history, next actions) arrives in Phase 3.
        </p>
      </div>
      {people.length === 0 ? (
        <EmptyState
          title="No people yet"
          description="People are created automatically when meetings mention commitments to or from them."
        />
      ) : (
        <div className="card divide-y divide-slate-200 dark:divide-slate-800">
          {people.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium">{p.full_name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {[p.role, p.organization, p.email].filter(Boolean).join(" · ") || "No details yet"}
                </p>
              </div>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                added {formatDate(p.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
