"use client";

import { useState } from "react";
import { Globe } from "lucide-react";

/**
 * On-demand public web research on a person, kept visually distinct from
 * internal facts (brief §11/§12: public research must be clearly separated).
 */
export default function PublicResearchButton({ personId }: { personId: string }) {
  const [findings, setFindings] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${personId}/research`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { research?: string; error?: string } | null;
      if (res.ok && body?.research) setFindings(body.research);
      else setError(body?.error ?? `Failed (${res.status})`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card border-dashed p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="card-title flex items-center gap-2">
          <Globe size={15} /> Public research
        </h2>
        <button className="btn-secondary !py-1.5 text-xs" onClick={run} disabled={busy}>
          {busy ? "Searching…" : findings ? "Refresh" : "Search the web"}
        </button>
      </div>
      {findings ? (
        <div className="mt-3 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{findings}</div>
      ) : (
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          Pulls current public info (role, company, recent news). Kept separate from internal notes.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
