"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CalendarClock, X } from "lucide-react";

export interface DeadlineView {
  id: string;
  what: string;
  dueLabel: string;
  source: string;
  rungCount: number;
}

export default function DeadlineReviewCard({ deadline }: { deadline: DeadlineView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "all" | "day" | "no") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/review/deadlines/${deadline.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card p-4">
      <p className="font-medium">📅 “{deadline.what}” — due {deadline.dueLabel}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Source: {deadline.source}</p>
      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-primary !py-1.5 text-xs" disabled={busy !== null} onClick={() => act("all")}>
          <Bell size={13} /> {busy === "all" ? "Setting…" : `Set ${deadline.rungCount === 1 ? "reminder" : `all ${deadline.rungCount}`}`}
        </button>
        <button className="btn-secondary !py-1.5 text-xs" disabled={busy !== null} onClick={() => act("day")}>
          <CalendarClock size={13} /> {busy === "day" ? "Setting…" : "On the day only"}
        </button>
        <button className="btn-secondary !py-1.5 text-xs" disabled={busy !== null} onClick={() => act("no")}>
          <X size={13} /> {busy === "no" ? "Ignoring…" : "Ignore"}
        </button>
      </div>
    </div>
  );
}
