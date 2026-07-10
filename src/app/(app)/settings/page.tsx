import { envStatus } from "@/lib/env";
import { listWebhookEvents } from "@/lib/db/repo";
import { StatusBadge } from "@/components/badges";
import JsonViewer from "@/components/JsonViewer";
import RetryWebhookButton from "@/components/RetryWebhookButton";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings — DeanOS" };

/**
 * Settings shows active connections and data flows (brief §21) plus the
 * webhook event log with raw payload inspection and retry (brief §23).
 */
export default async function SettingsPage() {
  const status = envStatus();
  const events = await listWebhookEvents(50);
  const appUrl = process.env.APP_URL ?? "https://<your-app>";

  const connections = [
    {
      name: "Circleback (via Zapier)",
      configured: status.ZAPIER_WEBHOOK_SECRET,
      detail: `Inbound: POST ${appUrl}/api/webhooks/zapier/circleback — meeting notes, transcripts and action items flow from Circleback → Zapier → DeanOS → OpenAI.`,
    },
    {
      name: "OpenAI",
      configured: status.OPENAI_API_KEY,
      detail:
        "Outbound: meeting title, notes, transcript, attendee names and action items are sent to the OpenAI API for extraction. Nothing else leaves DeanOS.",
    },
    {
      name: "Todoist (direct API)",
      configured: status.TODOIST_API_TOKEN,
      detail:
        "Outbound: approved tasks are created, updated and completed directly via the Todoist API — no Zapier tasks consumed. When not configured, the Zapier hooks below are used instead.",
    },
    {
      name: "Todoist via Zapier (fallback)",
      configured: status.ZAPIER_TODOIST_CREATE_HOOK_URL,
      detail: `Outbound fallback: Catch Hooks for create/update/complete; Zapier calls back to POST ${appUrl}/api/webhooks/zapier/todoist with the Todoist task ID.`,
    },
    {
      name: "Email ingestion (Heya / JIC / Gmail via Zapier)",
      configured: status.ZAPIER_WEBHOOK_SECRET,
      detail: `Inbound: POST ${appUrl}/api/webhooks/zapier/email — flagged/foldered emails flow from each mailbox's Zap with its business context. Bodies are stored truncated; the mail platform stays the system of record.`,
    },
    {
      name: "Calendar sync",
      configured: false,
      detail: "Phase 3 — not yet built.",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Active connections, data flows, and the inbound webhook log.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Connections & data flows
        </h2>
        <div className="card divide-y divide-slate-200 dark:divide-slate-800">
          {connections.map((c) => (
            <div key={c.name} className="flex items-start justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium">{c.name}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{c.detail}</p>
              </div>
              <span
                className={
                  c.configured
                    ? "badge bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    : "badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                }
              >
                {c.configured ? "configured" : "not configured"}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Configuration lives in environment variables — values are never displayed here. See
          .env.example and SECURITY.md.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Webhook log (latest 50)
        </h2>
        {events.length === 0 ? (
          <div className="card px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No webhook events received yet. Send a test from Zapier to see it here.
          </div>
        ) : (
          <div className="card divide-y divide-slate-200 dark:divide-slate-800">
            {events.map((e) => (
              <div key={e.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{e.endpoint}</span>
                    <StatusBadge status={e.status} />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {formatDateTime(e.received_at)}
                    </span>
                    {e.status === "failed" &&
                      ["zapier/circleback", "zapier/email"].includes(e.endpoint) && (
                        <RetryWebhookButton eventId={e.id} />
                      )}
                  </div>
                </div>
                {e.error && <p className="text-xs text-red-600 dark:text-red-400">{e.error}</p>}
                <JsonViewer label="Payload" value={e.payload ?? e.raw_body ?? null} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
