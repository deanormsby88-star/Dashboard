"use client";

import { useState } from "react";

/** Connect Garmin Connect (unofficial login) — email + password, verified on connect. */
export default function ConnectGarminCard({ connected, username }: { connected: boolean; username: string | null }) {
  const [user, setUser] = useState(username ?? "");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(connected);
  const [expanded, setExpanded] = useState(!connected);

  async function connect() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/garmin/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: user, password: pass }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg(body?.error ?? "Couldn't connect.");
        return;
      }
      setIsConnected(true);
      setExpanded(false);
      setPass("");
      setMsg("Connected. Garmin health data is now available to DeanOS.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Garmin Connect</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Pulls sleep, steps, resting HR and recent workouts into your brief and display. Uses an{" "}
            <strong>unofficial login</strong>, so your Garmin password is stored encrypted. It can break when Garmin
            changes their sign-in, and two-factor may block it.
          </p>
        </div>
        <span
          className={
            isConnected
              ? "badge bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : "badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          }
        >
          {isConnected ? "connected" : "not connected"}
        </span>
      </div>

      {isConnected && !expanded && (
        <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {username}{" "}
          <a className="ml-2 underline" href="/api/garmin/diagnose" target="_blank" rel="noopener noreferrer">
            Test read
          </a>
          <button className="ml-3 underline" onClick={() => setExpanded(true)}>
            Reconnect
          </button>
        </div>
      )}

      {expanded && (
        <div className="mt-3 space-y-2">
          <input
            className="form-input"
            placeholder="Garmin email"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
          />
          <input
            className="form-input"
            placeholder="Garmin password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            type="password"
            autoComplete="off"
          />
          <button onClick={connect} disabled={busy || !user || !pass} className="btn-secondary">
            {busy ? "Signing in…" : "Connect Garmin"}
          </button>
        </div>
      )}

      {msg && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{msg}</p>}
    </div>
  );
}
