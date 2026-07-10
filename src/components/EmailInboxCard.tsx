"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Check, ExternalLink, RefreshCw, Undo2 } from "lucide-react";
import clsx from "clsx";
import { ConfidenceBadge, StatusBadge } from "@/components/badges";

const CLASSIFICATION_STYLES: Record<string, string> = {
  action: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  waiting_on: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  risk: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  relationship_update: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  reference: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  ignore: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

export interface EmailView {
  id: string;
  mailbox: string;
  business: string | null;
  direction: string;
  sender: string;
  subject: string;
  summary: string | null;
  classification: string | null;
  confidence: number | null;
  email_date: string | null;
  source_url: string | null;
  suggested_task_id: string | null;
  processing_status: string;
  processing_error: string | null;
  resolved: boolean;
}

export default function EmailInboxCard({ email }: { email: EmailView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, body?: unknown) {
    setError(null);
    const res = await fetch(path, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? `Request failed (${res.status})`);
      return false;
    }
    return true;
  }

  async function act(kind: string, path: string, body?: unknown) {
    setBusy(kind);
    try {
      if (await call(path, body)) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={clsx("card p-4", email.resolved && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            {email.direction === "outbound" ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} />}
            <span className="font-medium">{email.business ?? email.mailbox}</span>
            <span>·</span>
            <span className="truncate">{email.sender}</span>
            {email.email_date && (
              <>
                <span>·</span>
                <span>{new Date(email.email_date).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </>
            )}
          </div>
          <p className="mt-1 font-medium">{email.subject || "(no subject)"}</p>
          {email.summary && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{email.summary}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {email.classification ? (
            <span className={clsx("badge", CLASSIFICATION_STYLES[email.classification])}>
              {email.classification.replace("_", " ")}
            </span>
          ) : (
            <StatusBadge status={email.processing_status} />
          )}
          <ConfidenceBadge confidence={email.confidence} />
        </div>
      </div>

      {email.processing_error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {email.processing_error}
        </p>
      )}
      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {email.suggested_task_id && (
          <Link href="/tasks" className="btn-secondary !py-1 text-xs">
            View suggested task
          </Link>
        )}
        {email.source_url && (
          <a href={email.source_url} target="_blank" rel="noreferrer" className="btn-secondary !py-1 text-xs">
            Open email <ExternalLink size={12} />
          </a>
        )}
        {email.processing_status === "failed" && (
          <button
            className="btn-secondary !py-1 text-xs"
            disabled={busy !== null}
            onClick={() => act("retry", `/api/emails/${email.id}/process`)}
          >
            <RefreshCw size={12} className={busy === "retry" ? "animate-spin" : undefined} />
            Retry
          </button>
        )}
        {email.resolved ? (
          <button
            className="btn-secondary !py-1 text-xs"
            disabled={busy !== null}
            onClick={() => act("reopen", `/api/emails/${email.id}/resolve`, { resolved: false })}
          >
            <Undo2 size={12} /> Reopen
          </button>
        ) : (
          <button
            className="btn-primary !py-1 text-xs"
            disabled={busy !== null}
            onClick={() => act("resolve", `/api/emails/${email.id}/resolve`, { resolved: true })}
          >
            <Check size={12} /> Mark handled
          </button>
        )}
      </div>
    </div>
  );
}
