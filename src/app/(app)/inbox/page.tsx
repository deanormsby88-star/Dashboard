import Link from "next/link";
import clsx from "clsx";
import { ensureOwner, listEmails } from "@/lib/db/repo";
import EmailInboxCard from "@/components/EmailInboxCard";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox — DeanOS" };

export default async function InboxPage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  const view = searchParams.view === "all" ? "all" : "open";
  const [owner, emails] = await Promise.all([
    ensureOwner(),
    listEmails({ unresolvedOnly: view === "open", limit: 100 }),
  ]);
  const businessNameFor = (id: string | null) =>
    owner.businesses.find((b) => b.id === id)?.name ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Inbox</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Email events from Heya, JIC and personal mail, classified by AI. Newsletters and
          reference mail are filed away automatically.
        </p>
      </div>

      <div className="flex gap-2">
        {[
          { label: "Needs attention", value: "open", href: "/inbox" },
          { label: "Everything", value: "all", href: "/inbox?view=all" },
        ].map((f) => (
          <Link
            key={f.value}
            href={f.href}
            className={clsx(
              "rounded-full px-3 py-1 text-sm transition-colors",
              view === f.value
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {emails.length === 0 ? (
        <EmptyState
          title={view === "open" ? "Inbox zero" : "No email events yet"}
          description={
            view === "open"
              ? "Nothing needs your attention. New flagged or DeanOS-foldered emails will appear here once the email Zaps are running."
              : "Connect the email Zaps (see ZAPIER_SETUP.md) and events will flow in here."
          }
        />
      ) : (
        <div className="space-y-3">
          {emails.map((e) => (
            <EmailInboxCard
              key={e.id}
              email={{
                id: e.id,
                mailbox: e.mailbox,
                business: businessNameFor(e.business_id),
                direction: e.direction,
                sender: e.sender,
                subject: e.subject,
                summary: e.summary,
                classification: e.classification,
                confidence: e.confidence,
                email_date: e.email_date ? e.email_date.toISOString() : null,
                source_url: e.source_url,
                suggested_task_id: e.suggested_task_id,
                processing_status: e.processing_status,
                processing_error: e.processing_error,
                resolved: e.resolved,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
