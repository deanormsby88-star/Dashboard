import Link from "next/link";
import { getCounts, getSyncStatus, listMeetings } from "@/lib/db/repo";
import { StatusBadge } from "@/components/badges";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today — DeanOS" };

/**
 * Phase 1 Today page: review queue, recent meetings and sync status.
 * The full executive dashboard (Top 3, waiting-on, risks, quick capture)
 * arrives in Phase 4 once the prioritizer exists.
 */
export default async function TodayPage() {
  const [counts, meetings, syncStatus] = await Promise.all([
    getCounts(),
    listMeetings(5),
    getSyncStatus(),
  ]);

  const stats = [
    { label: "Tasks awaiting review", value: counts.suggestedTasks, href: "/tasks?status=suggested" },
    { label: "Commitments by Dean", value: counts.openCommitmentsByDean, href: "/commitments" },
    { label: "Waiting on others", value: counts.openWaitingOn, href: "/commitments" },
    { label: "Open risks", value: counts.openRisks, href: "/risks" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-xl font-bold">Today</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      {(counts.failedMeetings > 0 || counts.pendingMeetings > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {counts.failedMeetings > 0 && (
            <span>
              {counts.failedMeetings} meeting{counts.failedMeetings === 1 ? "" : "s"} failed processing —{" "}
              <Link href="/meetings" className="font-medium underline">
                review and retry
              </Link>
              .{" "}
            </span>
          )}
          {counts.pendingMeetings > 0 && <span>{counts.pendingMeetings} meeting(s) still processing.</span>}
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card p-4 transition-colors hover:border-indigo-300 dark:hover:border-indigo-700">
            <div className="text-2xl font-bold">{s.value}</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{s.label}</div>
          </Link>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Recent meetings
          </h2>
          <Link href="/meetings" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
            All meetings
          </Link>
        </div>
        {meetings.length === 0 ? (
          <div className="card px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No meetings ingested yet. Once Zapier is connected (see ZAPIER_SETUP.md), finished
            Circleback meetings will land here automatically.
          </div>
        ) : (
          <div className="card divide-y divide-slate-200 dark:divide-slate-800">
            {meetings.map((m) => (
              <Link
                key={m.id}
                href={`/meetings/${m.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.title}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{formatDateTime(m.meeting_date)}</p>
                </div>
                <StatusBadge status={m.processing_status} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Sync status
        </h2>
        {syncStatus.length === 0 ? (
          <div className="card px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No webhook events received yet.
          </div>
        ) : (
          <div className="card divide-y divide-slate-200 text-sm dark:divide-slate-800">
            {syncStatus.map((s) => (
              <div key={s.endpoint} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="font-mono text-xs">{s.endpoint}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  last success: {formatDateTime(s.last_success)}
                  {s.failed_count > 0 && (
                    <span className="ml-2 text-red-600 dark:text-red-400">
                      {s.failed_count} failed (last {formatDateTime(s.last_failure)})
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
