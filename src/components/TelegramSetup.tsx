"use client";

import { useState } from "react";

interface Status {
  configured: boolean;
  reason?: string;
  bot?: { username?: string; first_name?: string; error?: string };
  webhook?: { url?: string; last_error_message?: string; error?: string };
}

/**
 * Settings widget: check bot status and (re)register the webhook. Env holds
 * the secrets; this just calls the admin endpoints.
 */
export default function TelegramSetup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function check() {
    setBusy("check");
    setMessage(null);
    try {
      const res = await fetch("/api/telegram/setup");
      setStatus((await res.json().catch(() => null)) as Status | null);
    } finally {
      setBusy(null);
    }
  }

  async function register() {
    setBusy("register");
    setMessage(null);
    try {
      const res = await fetch("/api/telegram/setup", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; webhookUrl?: string } | null;
      setMessage(res.ok ? `Webhook registered: ${body?.webhookUrl}` : `Failed: ${body?.error}`);
      await check();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary !py-1.5 text-xs" onClick={check} disabled={busy !== null}>
          {busy === "check" ? "Checking…" : "Check status"}
        </button>
        <button className="btn-primary !py-1.5 text-xs" onClick={register} disabled={busy !== null}>
          {busy === "register" ? "Registering…" : "Register webhook"}
        </button>
      </div>
      {message && <p className="text-xs text-slate-500 dark:text-slate-400">{message}</p>}
      {status && (
        <div className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
          {status.reason ? (
            <p>{status.reason}</p>
          ) : (
            <ul className="space-y-1">
              <li>Bot: {status.bot?.username ? `@${status.bot.username}` : (status.bot?.error ?? "unknown")}</li>
              <li>Webhook: {status.webhook?.url ? "registered" : "not registered"}</li>
              {status.webhook?.last_error_message && (
                <li className="text-rose-600 dark:text-rose-400">Last error: {status.webhook.last_error_message}</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
