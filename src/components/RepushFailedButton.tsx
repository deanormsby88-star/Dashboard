"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

export default function RepushFailedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/tasks/repush-failed", { method: "POST" });
      const b = (await res.json().catch(() => null)) as
        | { repushed?: number; stillFailing?: number; error?: string }
        | null;
      if (res.ok && typeof b?.repushed === "number") {
        setMsg(`Re-pushed ${b.repushed}${b.stillFailing ? `, ${b.stillFailing} still failing` : ""}.`);
        router.refresh();
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
        <RefreshCw size={13} /> {busy ? "Re-pushing…" : "Re-push failed"}
      </button>
      {msg && <span className="text-xs text-slate-500 dark:text-slate-400">{msg}</span>}
    </div>
  );
}
