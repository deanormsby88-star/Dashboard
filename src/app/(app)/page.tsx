import Link from "next/link";
import {
  getCounts,
  getLatestBrief,
  getSyncStatus,
  listCommitments,
  listMeetings,
  listRisks,
} from "@/lib/db/repo";
import { businessDaysBetween, ESCALATION_BUSINESS_DAYS } from "@/lib/dates";
import { ensureOwner, listCalendarConnections } from "@/lib/db/repo";
import { getToday } from "@/lib/calendar/sync";
import { SeverityBadge, StatusBadge } from "@/components/badges";
import QuickCapture from "@/components/QuickCapture";
import RefreshBriefButton from "@/components/RefreshBriefButton";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today — DeanOS" };

export default async function TodayPage() {
  const now = new Date();
  const owner = await ensureOwner();
  const [counts, meetings, syncStatus, brief, commitments, risks, todaysEvents] = await Promise.all([
    getCounts(),
    listMeetings(4),
    getSyncStatus(),
    getLatestBrief(),
    listCommitments(),
    listRisks(),
    getToday(owner.user.id).catch(() => []),
  ]);
  const calendarConnected = (await listCalendarConnections(owner.user.id)).length > 0;
  const fmtTime = (d: Date | null) =>
    d ? new Date(d).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" }) : "";

  const waitingOnDean = commitments.filter((c) => c.direction === "by_dean" && c.status === "open");
  const deanWaiting = commitments
    .filter((c) => c.direction === "to_dean" && c.status === "open")
    .map((c) => ({
      ...c,
      days: businessDaysBetween(new Date(c.date_made ?? c.created_at), now),
    }))
    .sort((a, b) => b.days - a.days);
  const openRisks = risks
    .filter((r) => r.status === "open")
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));

  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const briefIsToday = brief?.generated_for === now.toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">
            {now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{greeting}, Dean</h1>
        </div>
        <RefreshBriefButton label={brief ? "Refresh brief" : "Generate brief"} />
      </div>

      {(counts.failedMeetings > 0 || counts.pendingMeetings > 0) && (
        <div className="rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-200">
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

      <QuickCapture />

      {/* ── Top 3 ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="eyebrow">Top 3 today</h2>
          {brief && (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {briefIsToday ? "from this morning's brief" : `brief from ${brief.generated_for}`}
            </span>
          )}
        </div>
        {brief && brief.top3.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-3">
            {brief.top3.map((t, i) => (
              <div key={i} className="card p-5">
                <div className="text-xs font-bold text-slate-300 dark:text-slate-600">0{i + 1}</div>
                <p className="mt-1 font-semibold leading-snug">{t.title}</p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t.why}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="card px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No brief yet. Click “{brief ? "Refresh" : "Generate"} brief”, or ask the Assistant for{" "}
            <span className="font-medium">focus</span>.
          </div>
        )}
        {brief?.recommendation && (
          <p className="rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white dark:bg-white dark:text-slate-900">
            {brief.recommendation}
          </p>
        )}
      </section>

      {/* ── Today's meetings (calendar) ───────────────────────── */}
      {calendarConnected && (
        <section className="space-y-3">
          <h2 className="eyebrow">Today’s meetings ({todaysEvents.length})</h2>
          {todaysEvents.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing on your calendar today.</p>
          ) : (
            <div className="card divide-y divide-slate-100 dark:divide-white/5">
              {todaysEvents.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.title}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      {e.all_day ? "All day" : `${fmtTime(e.starts_at)}${e.ends_at ? `–${fmtTime(e.ends_at)}` : ""}`}
                      {e.location ? ` · ${e.location}` : ""}
                      {e.attendees.length > 0 ? ` · ${e.attendees.slice(0, 3).join(", ")}` : ""}
                    </p>
                  </div>
                  <span className="badge bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300">
                    {e.calendar}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Two columns: waiting-on both directions ───────────── */}
      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="eyebrow">Waiting on you ({waitingOnDean.length})</h2>
            <Link href="/commitments" className="text-xs text-slate-400 hover:underline dark:text-slate-500">
              All
            </Link>
          </div>
          {waitingOnDean.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing outstanding on you.</p>
          ) : (
            <div className="card divide-y divide-slate-100 dark:divide-white/5">
              {waitingOnDean.slice(0, 6).map((c) => (
                <div key={c.id} className="px-4 py-3 text-sm">
                  {c.text}
                  {c.person_name && <span className="text-slate-400 dark:text-slate-500"> · {c.person_name}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="eyebrow">You’re waiting on ({deanWaiting.length})</h2>
            <Link href="/commitments" className="text-xs text-slate-400 hover:underline dark:text-slate-500">
              All
            </Link>
          </div>
          {deanWaiting.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nobody owes you anything.</p>
          ) : (
            <div className="card divide-y divide-slate-100 dark:divide-white/5">
              {deanWaiting.slice(0, 6).map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-2 px-4 py-3 text-sm">
                  <span>
                    {c.text}
                    {c.person_name && <span className="text-slate-400 dark:text-slate-500"> · {c.person_name}</span>}
                  </span>
                  {c.days >= ESCALATION_BUSINESS_DAYS && (
                    <span className="badge shrink-0 bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                      {c.days}d — chase
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Risks + Ignore today ──────────────────────────────── */}
      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="eyebrow">Risks ({openRisks.length})</h2>
            <Link href="/risks" className="text-xs text-slate-400 hover:underline dark:text-slate-500">
              All
            </Link>
          </div>
          {openRisks.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No open risks.</p>
          ) : (
            <div className="card divide-y divide-slate-100 dark:divide-white/5">
              {openRisks.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-2 px-4 py-3 text-sm">
                  <span>{r.description}</span>
                  <span className="shrink-0">
                    <SeverityBadge severity={r.severity} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <h2 className="eyebrow">Ignore today</h2>
          {brief && brief.ignore_today.length > 0 ? (
            <div className="card divide-y divide-slate-100 dark:divide-white/5">
              {brief.ignore_today.slice(0, 6).map((s, i) => (
                <div key={i} className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                  {s}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nothing flagged to defer — generate a brief for suggestions.
            </p>
          )}
        </div>
      </section>

      {/* ── Meetings ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="eyebrow">Recent meetings</h2>
          <Link href="/meetings" className="text-xs text-slate-400 hover:underline dark:text-slate-500">
            All meetings
          </Link>
        </div>
        {meetings.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No meetings ingested yet.</p>
        ) : (
          <div className="card divide-y divide-slate-100 dark:divide-white/5">
            {meetings.map((m) => (
              <Link
                key={m.id}
                href={`/meetings/${m.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.title}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{formatDateTime(m.meeting_date)}</p>
                </div>
                <StatusBadge status={m.processing_status} />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Sync status ───────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="eyebrow">Sync status</h2>
        {syncStatus.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No webhook events received yet.</p>
        ) : (
          <div className="card divide-y divide-slate-100 text-sm dark:divide-white/5">
            {syncStatus.map((s) => (
              <div key={s.endpoint} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="font-mono text-xs">{s.endpoint}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  last success: {formatDateTime(s.last_success)}
                  {s.failed_count > 0 && (
                    <span className="ml-2 text-rose-600 dark:text-rose-400">{s.failed_count} failed</span>
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
