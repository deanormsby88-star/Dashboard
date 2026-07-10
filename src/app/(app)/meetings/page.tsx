import Link from "next/link";
import { listMeetings } from "@/lib/db/repo";
import { StatusBadge } from "@/components/badges";
import EmptyState from "@/components/EmptyState";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Meetings — DeanOS" };

export default async function MeetingsPage() {
  const meetings = await listMeetings();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Meetings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Ingested from Circleback via Zapier. Open a meeting to review what was extracted.
        </p>
      </div>

      {meetings.length === 0 ? (
        <EmptyState
          title="No meetings yet"
          description="When a Circleback meeting finishes, Zapier posts it here automatically. Follow ZAPIER_SETUP.md to connect the pipeline, or check Settings → Webhook log if you expected one."
        />
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
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDateTime(m.meeting_date)} · {m.source_system}
                </p>
              </div>
              <StatusBadge status={m.processing_status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
