"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Pencil, X } from "lucide-react";
import { ConfidenceBadge, PriorityBadge, StatusBadge } from "@/components/badges";

interface TaskView {
  id: string;
  title: string;
  description: string;
  priority: number;
  due_date: string | null;
  labels: string[];
  origin: string;
  status: string;
  status_error: string | null;
  confidence: number | null;
  todoist_task_url: string | null;
  source_system: string | null;
  source_url: string | null;
  business: string | null;
  created_at: string;
}

/**
 * One extracted task in the review screen: approve → sends to Todoist via
 * Zapier; edit → inline form; reject → keeps the record but marks it rejected.
 */
export default function TaskReviewCard({ task }: { task: TaskView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState(task.priority);
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [business, setBusiness] = useState(task.business ?? "");

  async function call(path: string, init?: RequestInit) {
    setError(null);
    const res = await fetch(path, init);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Request failed (${res.status})`);
      return false;
    }
    return true;
  }

  async function approve() {
    setBusy("approve");
    try {
      if (await call(`/api/tasks/${task.id}/approve`, { method: "POST" })) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy("reject");
    try {
      if (await call(`/api/tasks/${task.id}/reject`, { method: "POST" })) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit() {
    setBusy("save");
    try {
      const ok = await call(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          priority,
          due_date: dueDate === "" ? null : dueDate,
          ...(business ? { business } : {}),
        }),
      });
      if (ok) {
        setEditing(false);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  const reviewable = ["suggested", "failed", "approved"].includes(task.status);

  return (
    <div className="card p-4">
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="form-label">Title</label>
            <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Description</label>
            <textarea
              className="form-input"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="form-label">Priority</label>
              <select
                className="form-input"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              >
                <option value={4}>4 — urgent</option>
                <option value={3}>3 — important</option>
                <option value={2}>2 — normal</option>
                <option value={1}>1 — backlog</option>
              </select>
            </div>
            <div>
              <label className="form-label">Due date (only if explicit)</label>
              <input
                type="date"
                className="form-input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Business</label>
              <select className="form-input" value={business} onChange={(e) => setBusiness(e.target.value)}>
                <option value="">(unchanged)</option>
                <option value="heya">Heya</option>
                <option value="jic">JIC</option>
                <option value="personal">Personal</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={saveEdit} disabled={busy !== null}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button className="btn-secondary" onClick={() => setEditing(false)} disabled={busy !== null}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">{task.title}</p>
              {task.description && (
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{task.description}</p>
              )}
            </div>
            <StatusBadge status={task.status} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <PriorityBadge priority={task.priority} />
            <ConfidenceBadge confidence={task.confidence} />
            {task.due_date && <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">due {task.due_date}</span>}
            <span>origin: {task.origin}</span>
            {task.source_system && <span>source: {task.source_system}</span>}
            {task.source_url && (
              <a
                href={task.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-indigo-600 hover:underline dark:text-indigo-400"
              >
                source <ExternalLink size={12} />
              </a>
            )}
            {task.todoist_task_url && (
              <a
                href={task.todoist_task_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-indigo-600 hover:underline dark:text-indigo-400"
              >
                open in Todoist <ExternalLink size={12} />
              </a>
            )}
          </div>
          {task.status_error && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
              {task.status_error}
            </p>
          )}
          {error && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}
          {reviewable && (
            <div className="mt-3 flex gap-2">
              <button className="btn-primary" onClick={approve} disabled={busy !== null}>
                <Check size={14} />
                {busy === "approve" ? "Sending…" : task.status === "failed" ? "Retry send" : "Approve → Todoist"}
              </button>
              <button className="btn-secondary" onClick={() => setEditing(true)} disabled={busy !== null}>
                <Pencil size={14} /> Edit
              </button>
              <button className="btn-danger" onClick={reject} disabled={busy !== null}>
                <X size={14} /> Reject
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
