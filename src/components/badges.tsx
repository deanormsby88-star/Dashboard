import clsx from "clsx";

const STATUS_STYLES: Record<string, string> = {
  // task statuses
  suggested: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  sent: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  created: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  rejected: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  // meeting processing statuses
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  processed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  // webhook events
  received: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  duplicate: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  // commitments
  open: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  cancelled: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx("badge", STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
      {status}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null || confidence === undefined) return null;
  const pct = Math.round(Number(confidence) * 100);
  const style =
    pct >= 80
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : pct >= 50
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  return (
    <span className={clsx("badge", style)} title="AI confidence">
      {pct}%
    </span>
  );
}

const PRIORITY_LABELS: Record<number, { label: string; style: string }> = {
  4: { label: "P4 urgent", style: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  3: { label: "P3 important", style: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  2: { label: "P2 normal", style: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  1: { label: "P1 backlog", style: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
};

export function PriorityBadge({ priority }: { priority: number }) {
  const p = PRIORITY_LABELS[priority] ?? PRIORITY_LABELS[2];
  return <span className={clsx("badge", p.style)}>{p.label}</span>;
}

const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={clsx("badge", SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.low)}>
      {severity}
    </span>
  );
}

export function BusinessBadge({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <span className="badge bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300">
      {name}
    </span>
  );
}
