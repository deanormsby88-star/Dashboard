"use client";

import { useState } from "react";
import { Inbox } from "lucide-react";

export default function MoveToInboxButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/tasks/move-to-inbox", { method: "POST" });
      const b = (await res.json().catch(() => null)) as { moved?: number; failed?: number; error?: string } | null;
      if (res.ok && typeof b?.moved === "number") {
        setMsg(`Moved ${b.moved} to Inbox${b.failed ? `, ${b.failed} skipped` : ""}.`);
      } else {
        setMsg(b?.error ?? `Failed (${res.status})`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button className="btn-secondary !py-1.5 text-xs inline-flex items-center gap-1.5" onClick={run} disabled={busy}>
        <Inbox size={13} /> {busy ? "Moving…" : "Move all to Inbox"}
      </button>
      {msg && <span className="text-xs text-slate-500 dark:text-slate-400">{msg}</span>}
    </div>
  );
}
