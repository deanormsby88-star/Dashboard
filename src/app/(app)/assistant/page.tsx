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
        title="Next up"
        description="The Assistant is the next phase of the build: a chat command centre supporting sync, brief, focus, prep, waiting, commitments, risks, capture and more — one place to ask anything DeanOS knows."
      />
    </div>
  );
}
