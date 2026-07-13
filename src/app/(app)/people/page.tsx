import Link from "next/link";
import { listPeopleWithCounts } from "@/lib/db/repo";
import EmptyState from "@/components/EmptyState";
import ImportDirectoryButton from "@/components/ImportDirectoryButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "People — DeanOS" };

export default async function PeoplePage() {
  const people = await listPeopleWithCounts();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">People</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Everyone DeanOS has picked up from meetings, email and what you’ve told it. Open anyone
            for their full history and a recommended next move.
          </p>
        </div>
        <ImportDirectoryButton />
      </div>

      {people.length === 0 ? (
        <EmptyState
          title="No people yet"
          description="People appear automatically as they show up in meetings and email, or when you mention them to the Assistant."
        />
      ) : (
        <div className="card divide-y divide-slate-100 dark:divide-white/5">
          {people.map((p) => (
            <Link
              key={p.id}
              href={`/people/${p.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-300">
                  {p.full_name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.full_name}</p>
                  <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                    {[p.role, p.organization].filter(Boolean).join(" · ") || "No details yet"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {p.open_to_dean > 0 && (
                  <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    {p.open_to_dean} owe you
                  </span>
                )}
                {p.open_by_dean > 0 && (
                  <span className="badge bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300">
                    {p.open_by_dean} you owe
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
