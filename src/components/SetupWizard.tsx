"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConnectTelegramButton from "@/components/ConnectTelegramButton";

interface Context {
  key: string;
  name: string;
}

export default function SetupWizard({
  accountEmail,
  name,
  contexts: initialContexts,
  telegramLinked,
}: {
  accountEmail: string;
  name: string | null;
  contexts: Context[];
  telegramLinked: boolean;
}) {
  const router = useRouter();
  const [contexts, setContexts] = useState<Context[]>(
    initialContexts.length ? initialContexts : [{ key: "work", name: "Work" }, { key: "personal", name: "Personal" }]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function rename(key: string, value: string) {
    setContexts((cs) => cs.map((c) => (c.key === key ? { ...c, name: value } : c)));
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const save = await fetch("/api/setup/contexts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contexts }),
      });
      if (!save.ok) throw new Error("Couldn't save your contexts.");
      const done = await fetch("/api/setup/complete", { method: "POST" });
      if (!done.ok) throw new Error("Couldn't finish setup.");
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Step 1 — Microsoft (done via sign-in) */}
      <section className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Microsoft account</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Connected as {name ? `${name} · ` : ""}{accountEmail}
            </p>
          </div>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            ✓ Connected
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Your Outlook calendar and email are linked. Signing in did this automatically.
        </p>
      </section>

      {/* Step 2 — Contexts */}
      <section className="card p-5">
        <h2 className="font-semibold">Your work contexts</h2>
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
          Name the areas you want kept separate (e.g. your company, side projects, personal).
        </p>
        <div className="space-y-2">
          {contexts.map((c) => (
            <input
              key={c.key}
              className="form-input"
              value={c.name}
              onChange={(e) => rename(c.key, e.target.value)}
              aria-label={`Context ${c.key}`}
            />
          ))}
        </div>
      </section>

      {/* Step 3 — Telegram (optional but recommended) */}
      <section className="card p-5">
        <h2 className="font-semibold">Chat on Telegram</h2>
        <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
          Optional. Link Telegram to get your daily brief, reminders and nudges on your phone — and chat back by text or voice.
        </p>
        <ConnectTelegramButton linked={telegramLinked} />
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">Todoist can be connected later from Settings.</p>
      </section>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button onClick={finish} disabled={busy} className="btn-primary w-full">
        {busy ? "Finishing…" : "Finish setup"}
      </button>
    </div>
  );
}
