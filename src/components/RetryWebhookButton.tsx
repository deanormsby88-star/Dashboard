"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export default function RetryWebhookButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/webhook-events/${eventId}/retry`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Retry failed (${res.status})`);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-block">
      <button className="btn-secondary !px-2 !py-1 text-xs" onClick={run} disabled={busy}>
        <RefreshCw size={12} className={busy ? "animate-spin" : undefined} />
        Retry
      </button>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
