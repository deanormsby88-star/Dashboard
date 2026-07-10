import { notFound } from "next/navigation";
import {
  ensureOwner,
  getMeeting,
  getMeetingAttendees,
  getSourceRecordPayload,
  listCommitmentsForMeeting,
  listDecisionsForMeeting,
  listInteractionsForMeeting,
  listRisksForMeeting,
  listTasks,
} from "@/lib/db/repo";
import {
  BusinessBadge,
  ConfidenceBadge,
  SeverityBadge,
  StatusBadge,
} from "@/components/badges";
import TaskReviewCard from "@/components/TaskReviewCard";
import RetryProcessButton from "@/components/RetryProcessButton";
import JsonViewer from "@/components/JsonViewer";
import { formatDate, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MeetingReviewPage({ params }: { params: { id: string } }) {
  const meeting = await getMeeting(params.id);
  if (!meeting) notFound();

  const owner = await ensureOwner();
  const business = owner.businesses.find((b) => b.id === meeting.business_id) ?? null;
  const [attendees, tasks, commitments, decisions, risks, interactions, rawPayload] =
    await Promise.all([
      getMeetingAttendees(meeting.id),
      listTasks({ meetingId: meeting.id }),
      listCommitmentsForMeeting(meeting.id),
      listDecisionsForMeeting(meeting.id),
      listRisksForMeeting(meeting.id),
      listInteractionsForMeeting(meeting.id),
      getSourceRecordPayload(meeting.user_id, meeting.source_system, meeting.source_record_id),
    ]);

  const byDean = commitments.filter((c) => c.direction === "by_dean");
  const waitingOn = commitments.filter((c) => c.direction === "to_dean");
  const businessNameFor = (id: string | null) =>
    owner.businesses.find((b) => b.id === id)?.name ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">{meeting.title}</h1>
          <StatusBadge status={meeting.processing_status} />
          <BusinessBadge name={business?.name ?? null} />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {formatDateTime(meeting.meeting_date)}
          {attendees.length > 0 && (
            <> · {attendees.map((a) => a.name ?? a.email).filter(Boolean).join(", ")}</>
          )}
          {meeting.source_url && (
            <>
              {" · "}
              <a href={meeting.source_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">
                open in Circleback
              </a>
            </>
          )}
        </p>
        {meeting.summary && <p className="text-sm">{meeting.summary}</p>}
        {meeting.recommended_follow_up && (
          <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">
            <span className="font-medium">Recommended follow-up:</span> {meeting.recommended_follow_up}
          </p>
        )}
        {meeting.processing_status === "failed" && (
          <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
            <p className="text-sm text-red-700 dark:text-red-300">
              <span className="font-medium">Processing failed:</span> {meeting.processing_error}
            </p>
            <RetryProcessButton meetingId={meeting.id} label="Retry processing" />
          </div>
        )}
        {meeting.processing_status === "processed" && (
          <RetryProcessButton meetingId={meeting.id} />
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Suggested tasks ({tasks.length})
        </h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No tasks were extracted from this meeting.
          </p>
        ) : (
          tasks.map((t) => (
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
          ))
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Commitments Dean made ({byDean.length})
          </h2>
          {byDean.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">None detected.</p>
          ) : (
            byDean.map((c) => (
              <div key={c.id} className="card p-3 text-sm">
                <p>{c.text}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  {c.person_name && <span>to {c.person_name}</span>}
                  {c.due_date && <span>due {formatDate(c.due_date)}</span>}
                  <ConfidenceBadge confidence={c.confidence} />
                </div>
              </div>
            ))
          )}
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Waiting on others ({waitingOn.length})
          </h2>
          {waitingOn.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">None detected.</p>
          ) : (
            waitingOn.map((c) => (
              <div key={c.id} className="card p-3 text-sm">
                <p>{c.text}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  {c.person_name && <span>from {c.person_name}</span>}
                  <ConfidenceBadge confidence={c.confidence} />
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Decisions ({decisions.length})
          </h2>
          {decisions.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">None detected.</p>
          ) : (
            decisions.map((d) => (
              <div key={d.id} className="card p-3 text-sm">
                <p>{d.text}</p>
                <div className="mt-2">
                  <ConfidenceBadge confidence={d.confidence} />
                </div>
              </div>
            ))
          )}
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Risks ({risks.length})
          </h2>
          {risks.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">None detected.</p>
          ) : (
            risks.map((r) => (
              <div key={r.id} className="card p-3 text-sm">
                <p>{r.description}</p>
                <div className="mt-2 flex gap-2">
                  <SeverityBadge severity={r.severity} />
                  <ConfidenceBadge confidence={r.confidence} />
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {interactions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Relationship updates ({interactions.length})
          </h2>
          {interactions.map((i) => (
            <div key={i.id} className="card p-3 text-sm">
              <p>
                <span className="font-medium">{i.person_name}:</span> {i.summary}
              </p>
              <div className="mt-2">
                <ConfidenceBadge confidence={i.confidence} />
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card space-y-3 p-4">
        <JsonViewer label="Raw Circleback payload" value={rawPayload} />
        {meeting.notes && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
              Meeting notes
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{meeting.notes}</p>
          </details>
        )}
        {meeting.transcript && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
              Transcript
            </summary>
            <p className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
              {meeting.transcript}
            </p>
          </details>
        )}
      </section>
    </div>
  );
}
