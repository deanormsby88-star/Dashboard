import Link from "next/link";
import clsx from "clsx";
import { listRisks } from "@/lib/db/repo";
import RiskCard, { type RiskView } from "@/components/RiskCard";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";
export const metadata = { title: "Risks — DeanOS" };

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as Record<string, number>;

export default async function RisksPage({ searchParams }: { searchParams: { show?: string } }) {
  const showAll = searchParams.show === "all";
  const all = await listRisks();
  const visible = (showAll ? all : all.filter((r) => r.status === "open")).sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Risks</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Material risks surfaced from meetings and email. Mark them mitigated, close them, or
          edit the wording and severity.
        </p>
      </div>

      <div className="flex gap-2">
        {[
          { label: "Open", value: "open", href: "/risks" },
          { label: "All", value: "all", href: "/risks?show=all" },
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

      {visible.length === 0 ? (
        <EmptyState
          title={showAll ? "No risks tracked" : "No open risks"}
          description="Operational, client, people, financial, legal and technical risks raised in meetings or email appear here. You can also log one with the Assistant: capture risk cash flow tight in August."
        />
      ) : (
        <div className="space-y-3">
          {visible.map((r) => (
            <RiskCard
              key={r.id}
              risk={{
                id: r.id,
                description: r.description,
                severity: r.severity,
                status: r.status,
                confidence: r.confidence,
                created_at: r.created_at.toISOString(),
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
