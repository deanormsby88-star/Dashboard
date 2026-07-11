"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

/**
 * Today's one-field capture box (brief §6). Sends free text to the Assistant's
 * `capture` command, which routes it to the right record — tasks go straight
 * to Todoist, waiting-ons/risks/notes are filed.
 */
export default function QuickCapture() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: `capture ${trimmed}` }),
      });
      const body = (await res.json().catch(() => null)) as { reply?: string; error?: string } | null;
      setResult(res.ok && body?.reply ? body.reply : body?.error ?? "Something went wrong.");
      if (res.ok) {
        setText("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <form onSubmit={submit} className="flex items-center gap-2">
        <Sparkles size={18} className="shrink-0 text-slate-400" />
        <input
          className="form-input !shadow-none !border-0 !bg-transparent !px-0 !ring-0 focus:!ring-0"
          placeholder="Capture anything — a task, a note, who you're waiting on…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn-primary shrink-0" disabled={busy || !text.trim()}>
          {busy ? "Capturing…" : "Capture"}
        </button>
      </form>
      {result && (
        <p className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-white/5 dark:text-slate-300">
          {result}
        </p>
      )}
    </div>
  );
}
