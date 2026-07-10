import EmptyState from "@/components/EmptyState";

export const metadata = { title: "Inbox — DeanOS" };

export default function InboxPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Inbox</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          A normalized feed of unresolved events from every source.
        </p>
      </div>
      <EmptyState
        title="Coming in Phase 2"
        description="The Inbox will unify unresolved events from Circleback, email, calendar, Todoist and manual capture, with AI classification and suggested actions. Phase 1 focuses on the Circleback → review → Todoist flow — see Meetings."
      />
    </div>
  );
}
