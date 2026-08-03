"use client";

import { useState } from "react";

interface List {
  displayName: string;
  url: string;
}

/**
 * Connect Apple Reminders (iCloud CalDAV): enter an Apple ID + app-specific
 * password, verify, then pick the single list DeanOS reads/writes.
 */
export default function ConnectAppleRemindersCard({
  connected,
  username,
  listName,
}: {
  connected: boolean;
  username: string | null;
  listName: string | null;
}) {
  const [appleId, setAppleId] = useState(username ?? "");
  const [appPassword, setAppPassword] = useState("");
  const [lists, setLists] = useState<List[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [savedList, setSavedList] = useState<string | null>(listName);
  const [expanded, setExpanded] = useState(!connected);

  async function connect() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/reminders/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appleId, appPassword }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg(body?.error ?? "Couldn't connect.");
        return;
      }
      setLists(body.lists ?? []);
      setMsg(body.lists?.length ? "Connected. Now choose the list to use." : "Connected, but no Reminders lists were found.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseList(l: List) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/reminders/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: l.url, name: l.displayName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setMsg(body?.error ?? "Couldn't save the list.");
        return;
      }
      setSavedList(l.displayName);
      setLists([]);
      setExpanded(false);
      setAppPassword("");
      setMsg(`Using “${l.displayName}”. Apple Reminders is connected.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Apple Reminders</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Connect iCloud so DeanOS can use one Reminders list as your task home. Context (Heya / JIC / Personal) rides
            along as a #tag on each reminder. Uses an <strong>app-specific password</strong>, stored encrypted — never your
            main Apple password.
          </p>
        </div>
        <span
          className={
            connected && savedList
              ? "badge bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : "badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          }
        >
          {connected && savedList ? "connected" : connected ? "pick a list" : "not connected"}
        </span>
      </div>

      {connected && savedList && !expanded && (
        <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {username} · list: <strong>{savedList}</strong>{" "}
          <button className="ml-2 underline" onClick={() => setExpanded(true)}>
            Change
          </button>
        </div>
      )}

      {expanded && (
        <div className="mt-3 space-y-2">
          <input
            className="form-input"
            placeholder="Apple ID (email)"
            value={appleId}
            onChange={(e) => setAppleId(e.target.value)}
            autoComplete="username"
          />
          <input
            className="form-input"
            placeholder="App-specific password (xxxx-xxxx-xxxx-xxxx)"
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            type="password"
            autoComplete="off"
          />
          <button onClick={connect} disabled={busy || !appleId || !appPassword} className="btn-secondary">
            {busy ? "Checking…" : "Connect & list my Reminders lists"}
          </button>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Create one at appleid.apple.com → Sign-In &amp; Security → App-Specific Passwords.
          </p>

          {lists.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <p className="text-xs font-medium">Choose the list to use:</p>
              {lists.map((l) => (
                <button key={l.url} onClick={() => chooseList(l)} disabled={busy} className="btn-secondary !py-1.5 block w-full text-left text-sm">
                  {l.displayName}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {msg && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{msg}</p>}
    </div>
  );
}
