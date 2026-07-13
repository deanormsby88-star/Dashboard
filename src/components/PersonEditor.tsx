"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

interface PersonFields {
  id: string;
  full_name: string;
  role: string | null;
  organization: string | null;
  email: string | null;
  phone?: string | null;
  notes?: string | null;
}

export default function PersonEditor({ person }: { person: PersonFields }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [form, setForm] = useState({
    fullName: person.full_name,
    role: person.role ?? "",
    organization: person.organization ?? "",
    email: person.email ?? "",
    phone: person.phone ?? "",
    notes: person.notes ?? "",
  });

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? `Failed (${res.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${person.id}`, { method: "DELETE" });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? `Failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.push("/people");
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <button className="btn-secondary !py-1.5 text-xs inline-flex items-center gap-1.5" onClick={() => setEditing(true)}>
          <Pencil size={13} /> Edit
        </button>
        {confirmDelete ? (
          <span className="inline-flex items-center gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">Remove {person.full_name}?</span>
            <button
              className="rounded-lg bg-rose-600 px-2.5 py-1.5 font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              onClick={remove}
              disabled={busy}
            >
              {busy ? "Removing…" : "Yes, remove"}
            </button>
            <button className="text-slate-500 hover:underline dark:text-slate-400" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="btn-secondary !py-1.5 text-xs inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={13} /> Remove
          </button>
        )}
        {error && <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>}
      </div>
    );
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Name
          <input className="form-input mt-1" {...field("fullName")} />
        </label>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Role
          <input className="form-input mt-1" {...field("role")} placeholder="e.g. Operations lead" />
        </label>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Organization
          <input className="form-input mt-1" {...field("organization")} />
        </label>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Email
          <input className="form-input mt-1" {...field("email")} type="email" />
        </label>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Phone
          <input className="form-input mt-1" {...field("phone")} />
        </label>
      </div>
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
        Notes
        <textarea className="form-input mt-1 min-h-[80px]" {...field("notes")} placeholder="Anything worth remembering" />
      </label>
      <div className="flex items-center gap-2">
        <button className="btn-primary !py-1.5 text-xs" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn-secondary !py-1.5 text-xs" onClick={() => setEditing(false)} disabled={busy}>
          Cancel
        </button>
        {error && <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>}
      </div>
    </div>
  );
}
