"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";

export default function NextActionButton({ personId }: { personId: string }) {
  const [action, setAction] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${personId}/next-action`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { action?: string; error?: string } | null;
      if (res.ok && body?.action) setAction(body.action);
      else setError(body?.error ?? `Failed (${res.status})`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="card-title flex items-center gap-2">
          <Sparkles size={15} /> Next recommended action
        </h2>
        <button className="btn-secondary !py-1.5 text-xs" onClick={run} disabled={busy}>
          {busy ? "Thinking…" : action ? "Refresh" : "Suggest"}
        </button>
      </div>
      {action && <p className="mt-3 text-sm">{action}</p>}
      {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
