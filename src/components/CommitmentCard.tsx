"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Undo2, X } from "lucide-react";
import clsx from "clsx";
import { ConfidenceBadge, StatusBadge } from "@/components/badges";

export interface CommitmentView {
  id: string;
  direction: "by_dean" | "to_dean";
  text: string;
  person_name: string | null;
  date_made: string | null;
  due_date: string | null;
  status: "open" | "done" | "cancelled";
  confidence: number | null;
  source_system: string | null;
  business_days?: number;
}

export default function CommitmentCard({ commitment }: { commitment: CommitmentView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(commitment.text);
  const [person, setPerson] = useState(commitment.person_name ?? "");
  const [dueDate, setDueDate] = useState(commitment.due_date ?? "");

  async function patch(body: unknown, kind: string) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/commitments/${commitment.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? `Request failed (${res.status})`);
        return false;
      }
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function act(body: unknown, kind: string) {
    if (await patch(body, kind)) {
      setEditing(false);
      router.refresh();
    }
  }

  const resolved = commitment.status !== "open";
  const overdue = (commitment.business_days ?? 0) >= 3 && commitment.status === "open";
  const relationLabel = commitment.direction === "by_dean" ? "to" : "from";

  return (
    <div className={clsx("card p-4", resolved && "opacity-60")}>
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="form-label">Commitment</label>
            <textarea className="form-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[12rem] flex-1">
              <label className="form-label">Person</label>
              <input className="form-input" value={person} onChange={(e) => setPerson(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Due date (optional)</label>
              <input type="date" className="form-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={busy !== null}
              onClick={() =>
                act({ text, person: person || null, due_date: dueDate === "" ? null : dueDate }, "save")
              }
            >
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
            <p className="text-sm">{commitment.text}</p>
            <StatusBadge status={commitment.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {commitment.person_name && (
              <span>
                {relationLabel} {commitment.person_name}
              </span>
            )}
            {commitment.due_date && <span>due {commitment.due_date}</span>}
            {overdue && (
              <span className="badge bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                {commitment.business_days} business days — chase
              </span>
            )}
            <ConfidenceBadge confidence={commitment.confidence} />
          </div>
          {error && (
            <p className="mt-2 rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300">
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {!resolved ? (
              <>
                <button className="btn-primary !py-1.5 text-xs" disabled={busy !== null} onClick={() => act({ status: "done" }, "done")}>
                  <Check size={13} /> {commitment.direction === "by_dean" ? "Done" : "Resolved"}
                </button>
                <button className="btn-secondary !py-1.5 text-xs" disabled={busy !== null} onClick={() => setEditing(true)}>
                  <Pencil size={13} /> Edit
                </button>
                <button className="btn-secondary !py-1.5 text-xs" disabled={busy !== null} onClick={() => act({ status: "cancelled" }, "cancel")}>
                  <X size={13} /> Unnecessary
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
