"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, ShieldCheck, Undo2, X } from "lucide-react";
import clsx from "clsx";
import { ConfidenceBadge, SeverityBadge, StatusBadge } from "@/components/badges";

export interface RiskView {
  id: string;
  description: string;
  severity: "low" | "medium" | "high";
  status: "open" | "mitigated" | "closed";
  confidence: number | null;
  created_at: string;
}

export default function RiskCard({ risk }: { risk: RiskView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(risk.description);
  const [severity, setSeverity] = useState(risk.severity);

  async function act(body: unknown, kind: string) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/risks/${risk.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? `Request failed (${res.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const resolved = risk.status !== "open";

  return (
    <div className={clsx("card p-4", resolved && "opacity-60")}>
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="form-label">Risk</label>
            <textarea className="form-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Severity</label>
            <select className="form-input max-w-[10rem]" value={severity} onChange={(e) => setSeverity(e.target.value as RiskView["severity"])}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy !== null} onClick={() => act({ description, severity }, "save")}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button className="btn-secondary" disabled={busy !== null} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm">{risk.description}</p>
            <StatusBadge status={risk.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <SeverityBadge severity={risk.severity} />
            <ConfidenceBadge confidence={risk.confidence} />
          </div>
          {error && (
            <p className="mt-2 rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300">
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {!resolved ? (
              <>
                <button className="btn-primary !py-1.5 text-xs" disabled={busy !== null} onClick={() => act({ status: "mitigated" }, "mitigate")}>
                  <ShieldCheck size={13} /> Mitigated
                </button>
                <button className="btn-secondary !py-1.5 text-xs" disabled={busy !== null} onClick={() => setEditing(true)}>
                  <Pencil size={13} /> Edit
                </button>
                <button className="btn-secondary !py-1.5 text-xs" disabled={busy !== null} onClick={() => act({ status: "closed" }, "close")}>
                  <X size={13} /> Close
                </button>
              </>
            ) : (
              <button className="btn-secondary !py-1.5 text-xs" disabled={busy !== null} onClick={() => act({ status: "open" }, "reopen")}>
                <Undo2 size={13} /> Reopen
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
