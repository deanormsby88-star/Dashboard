import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPersonBundleById } from "@/lib/db/repo";
import { StatusBadge } from "@/components/badges";
import NextActionButton from "@/components/NextActionButton";
import PersonEditor from "@/components/PersonEditor";
import PublicResearchButton from "@/components/PublicResearchButton";
import { formatDate, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: { id: string } }) {
  const bundle = await getPersonBundleById(params.id);
  if (!bundle.person) notFound();
  const p = bundle.person;

  const owed = bundle.commitments.filter((c) => c.direction === "to_dean");
  const promised = bundle.commitments.filter((c) => c.direction === "by_dean");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/people" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft size={15} /> People
      </Link>

      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-lg font-bold text-white dark:bg-white dark:text-slate-900">
          {p.full_name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{p.full_name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {[p.role, p.organization, p.email, p.phone].filter(Boolean).join(" · ") || "No details on file yet"}
          </p>
        </div>
      </div>

      <PersonEditor person={p} />

      {p.notes && (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-white/5 dark:text-slate-300">
          {p.notes}
        </p>
      )}

      <NextActionButton personId={p.id} />
      <PublicResearchButton personId={p.id} />

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="eyebrow">They owe you ({owed.filter((c) => c.status === "open").length} open)</h2>
          {owed.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing tracked.</p>
          ) : (
            <div className="card divide-y divide-slate-100 dark:divide-white/5">
              {owed.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-2 px-4 py-3 text-sm">
                  <span>{c.text}</span>
                  <StatusBadge status={c.status} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <h2 className="eyebrow">You promised them ({promised.filter((c) => c.status === "open").length} open)</h2>
          {promised.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing tracked.</p>
          ) : (
            <div className="card divide-y divide-slate-100 dark:divide-white/5">
              {promised.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-2 px-4 py-3 text-sm">
                  <span>{c.text}</span>
                  <StatusBadge status={c.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {bundle.meetings.length > 0 && (
        <section className="space-y-3">
          <h2 className="eyebrow">Meetings together</h2>
          <div className="card divide-y divide-slate-100 dark:divide-white/5">
            {bundle.meetings.map((m, i) => (
              <div key={i} className="px-4 py-3">
                <p className="text-sm font-medium">{m.title}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{formatDateTime(m.meeting_date)}</p>
                {m.summary && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{m.summary}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {bundle.emails.length > 0 && (
        <section className="space-y-3">
          <h2 className="eyebrow">Recent email</h2>
          <div className="card divide-y divide-slate-100 dark:divide-white/5">
            {bundle.emails.map((e, i) => (
              <div key={i} className="px-4 py-3">
                <p className="text-sm">{e.subject}</p>
                {e.summary && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{e.summary}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {bundle.interactions.length > 0 && (
        <section className="space-y-3">
          <h2 className="eyebrow">Notes &amp; history</h2>
          <div className="card divide-y divide-slate-100 dark:divide-white/5">
            {bundle.interactions.map((i) => (
              <div key={i.id} className="px-4 py-3">
                <p className="text-sm">{i.summary}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{formatDate(i.occurred_at)}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
