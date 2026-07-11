import AssistantChat from "@/components/AssistantChat";

export const metadata = { title: "Assistant — DeanOS" };

export default function AssistantPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h1 className="text-xl font-bold">Assistant</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Your chief of staff. Everything DeanOS knows, one question away.
        </p>
      </div>
      <AssistantChat />
    </div>
  );
}
