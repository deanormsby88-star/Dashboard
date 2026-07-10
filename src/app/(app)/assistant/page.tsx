import EmptyState from "@/components/EmptyState";

export const metadata = { title: "Assistant — DeanOS" };

export default function AssistantPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Assistant</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Natural-language command centre.
        </p>
      </div>
      <EmptyState
        title="Coming in Phase 4"
        description="The Assistant will support commands like sync, brief, focus, prep, waiting, commitments, risks and quick capture. It arrives after email, calendar and the prioritizer are in place."
      />
    </div>
  );
}
