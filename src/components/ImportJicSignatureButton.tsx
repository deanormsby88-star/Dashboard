"use client";

import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";

export default function ImportJicSignatureButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/email/import-jic-signature", { method: "POST" });
      const b = (await res.json().catch(() => null)) as { imported?: string; error?: string } | null;
      setMsg(res.ok && b?.imported ? `Imported "${b.imported}" — now on your JIC emails.` : (b?.error ?? `Failed (${res.status})`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button className="btn-secondary !py-1.5 text-xs inline-flex items-center gap-1.5" onClick={run} disabled={busy}>
        <ImageIcon size={13} /> {busy ? "Importing…" : "Import JIC signature"}
      </button>
      {msg && <span className="text-xs text-slate-500 dark:text-slate-400">{msg}</span>}
    </div>
  );
}
