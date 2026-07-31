"use client";

import { useState } from "react";

/**
 * Reveals the read-only display API URL + Bearer token for an external panel
 * (e.g. SenseCraft). Fetched on demand so the token isn't rendered until asked.
 */
export default function DisplayApiCard() {
  const [data, setData] = useState<{ url: string; url_no_token: string; header: { Authorization: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function reveal() {
    setBusy(true);
    try {
      const res = await fetch("/api/display/token");
      const body = await res.json().catch(() => null);
      if (res.ok && body?.url) setData(body);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, which: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">External display (SenseCraft &amp; others)</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            A read-only feed of today&apos;s schedule, tasks due, and open loops for a desk display. Paste the URL into the
            panel&apos;s “External API” config. The token is a private key — anyone with it can read this summary, so don&apos;t share it.
          </p>
        </div>
      </div>

      {!data ? (
        <button onClick={reveal} disabled={busy} className="btn-secondary mt-3 !py-1.5 text-xs">
          {busy ? "Loading…" : "Show my display link"}
        </button>
      ) : (
        <div className="mt-3 space-y-3">
          <Field label="Simplest — API URL (token in the link)" value={data.url} onCopy={() => copy(data.url, "url")} copied={copied === "url"} />
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Or, if the panel supports headers:</p>
            <Field label="API URL" value={data.url_no_token} onCopy={() => copy(data.url_no_token, "u2")} copied={copied === "u2"} />
            <Field
              label="Header (JSON)"
              value={JSON.stringify(data.header)}
              onCopy={() => copy(JSON.stringify(data.header), "hdr")}
              copied={copied === "hdr"}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onCopy, copied }: { label: string; value: string; onCopy: () => void; copied: boolean }) {
  return (
    <div>
      <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg bg-slate-100 px-2 py-1.5 text-xs dark:bg-slate-800">{value}</code>
        <button onClick={onCopy} className="btn-secondary !py-1.5 text-xs">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
