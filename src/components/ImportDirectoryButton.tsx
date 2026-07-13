"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Users } from "lucide-react";

export default function ImportDirectoryButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/people/import-directory", { method: "POST" });
      const b = (await res.json().catch(() => null)) as { updated?: number; error?: string } | null;
      if (res.ok && typeof b?.updated === "number") {
        setMsg(`Imported ${b.updated} team profiles.`);
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
        <Users size={13} /> {busy ? "Importing…" : "Import Heya directory"}
      </button>
      {msg && <span className="text-xs text-slate-500 dark:text-slate-400">{msg}</span>}
    </div>
  );
}
