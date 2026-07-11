"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export default function RefreshBriefButton({ label = "Refresh" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/brief/generate", { method: "POST" });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end">
      <button className="btn-secondary !py-1.5 text-xs" onClick={run} disabled={busy}>
        <RefreshCw size={13} className={busy ? "animate-spin" : undefined} />
        {busy ? "Generating…" : label}
      </button>
      {error && <span className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</span>}
    </div>
  );
}
