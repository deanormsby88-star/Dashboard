"use client";

import { useState } from "react";

/**
 * Connect Telegram: fetches a personal deep link and opens it, so tapping in
 * Telegram links the user's chat to their DeanOS account.
 */
export default function ConnectTelegramButton({ linked }: { linked: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/telegram/link");
      const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !body?.url) {
        setMsg(body?.error ?? "Couldn't create a link right now.");
        return;
      }
      window.open(body.url, "_blank", "noopener,noreferrer");
      setMsg("Opening Telegram — tap Start there to finish linking.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button onClick={connect} disabled={busy} className="btn-secondary">
        {busy ? "Preparing…" : linked ? "Re-link Telegram" : "Connect Telegram"}
      </button>
      {linked && !msg && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ Telegram connected.</p>
      )}
      {msg && <p className="text-xs text-slate-500 dark:text-slate-400">{msg}</p>}
    </div>
  );
}
