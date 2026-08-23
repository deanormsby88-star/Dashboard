"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Mail, Send, X } from "lucide-react";

export interface ChaseView {
  id: string;
  personName: string;
  draft: string;
  subject: string;
  hasCommitment: boolean;
}

export default function ChaseReviewCard({ chase }: { chase: ChaseView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "teams" | "email" | "ignore" | "done") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/review/chases/${chase.id}`, {
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
      <p className="font-medium">💬 Draft for {chase.personName}</p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">“{chase.draft}”</p>
      {chase.hasCommitment && (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          Mark done closes it out for good — Not now just skips this reminder, it'll come back if still open.
        </p>
      )}
      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-primary !py-1.5 text-xs" disabled={busy !== null} onClick={() => act("teams")}>
          <Send size={13} /> {busy === "teams" ? "Sending…" : "Send via Teams"}
        </button>
        <button className="btn-secondary !py-1.5 text-xs" disabled={busy !== null} onClick={() => act("email")}>
          <Mail size={13} /> {busy === "email" ? "Drafting…" : "Email instead"}
        </button>
        <button className="btn-secondary !py-1.5 text-xs" disabled={busy !== null} onClick={() => act("done")}>
          <Check size={13} /> {busy === "done" ? "Marking…" : chase.hasCommitment ? "Mark done" : "Handled"}
        </button>
        <button className="btn-secondary !py-1.5 text-xs" disabled={busy !== null} onClick={() => act("ignore")}>
          <X size={13} /> {busy === "ignore" ? "…" : "Not now"}
        </button>
      </div>
    </div>
  );
}
