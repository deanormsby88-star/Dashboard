import Link from "next/link";
import clsx from "clsx";
import { listCommitments } from "@/lib/db/repo";
import { businessDaysBetween } from "@/lib/dates";
import CommitmentCard, { type CommitmentView } from "@/components/CommitmentCard";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";
export const metadata = { title: "Commitments — DeanOS" };

function toView(c: Awaited<ReturnType<typeof listCommitments>>[number], now: Date): CommitmentView {
  return {
    id: c.id,
    direction: c.direction,
    text: c.text,
    person_name: c.person_name,
    date_made: c.date_made ? String(c.date_made).slice(0, 10) : null,
    due_date: c.due_date ? String(c.due_date).slice(0, 10) : null,
    status: c.status,
    confidence: c.confidence,
    source_system: c.source_system,
    business_days: businessDaysBetween(new Date(c.date_made ?? c.created_at), now),
  };
}

export default async function CommitmentsPage({ searchParams }: { searchParams: { show?: string } }) {
  const showAll = searchParams.show === "all";
  const now = new Date();
  const all = await listCommitments();
  const visible = showAll ? all : all.filter((c) => c.status === "open");
  const byDean = visible.filter((c) => c.direction === "by_dean");
  const toDean = visible.filter((c) => c.direction === "to_dean");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Commitments</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Both directions: what you promised, and what others owe you. Mark them done, edit them,
          or flag them unnecessary.
        </p>
      </div>

      <div className="flex gap-2">
        {[
          { label: "Open", value: "open", href: "/commitments" },
          { label: "All", value: "all", href: "/commitments?show=all" },
        ].map((f) => (
          <Link
            key={f.value}
            href={f.href}
            className={clsx(
              "rounded-full px-3 py-1 text-sm transition-colors",
              (showAll ? "all" : "open") === f.value
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {all.length === 0 ? (
        <EmptyState
          title="No commitments tracked yet"
          description="Commitments you make in meetings — and things others promise you — are extracted automatically. You can also add one with the Assistant: capture waiting on Priya for the artwork."
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="space-y-3">
            <h2 className="eyebrow">You promised ({byDean.length})</h2>
            {byDean.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nothing outstanding.</p>
            ) : (
              byDean.map((c) => <CommitmentCard key={c.id} commitment={toView(c, now)} />)
            )}
          </section>
          <section className="space-y-3">
            <h2 className="eyebrow">Waiting on others ({toDean.length})</h2>
            {toDean.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nobody owes you anything.</p>
            ) : (
              toDean.map((c) => <CommitmentCard key={c.id} commitment={toView(c, now)} />)
            )}
          </section>
        </div>
      )}
    </div>
  );
}
