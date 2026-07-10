"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export default function RetryProcessButton({
  meetingId,
  label = "Reprocess meeting",
}: {
  meetingId: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/process`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Processing failed (${res.status})`);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn-secondary" onClick={run} disabled={busy}>
        <RefreshCw size={14} className={busy ? "animate-spin" : undefined} />
        {busy ? "Processing…" : label}
      </button>
      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
