import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import SetupWizard from "@/components/SetupWizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up — DeanOS" };

export default async function SetupPage() {
  const owner = await getSessionUser();
  if (!owner) redirect("/login");
  if (owner.user.setup_completed_at) redirect("/");

  return (
    <div className="mx-auto min-h-screen max-w-xl px-4 py-12">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-3xl bg-slate-900 text-lg font-bold text-white dark:bg-white dark:text-slate-900">
          D
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome to DeanOS</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          A couple of quick steps and your assistant is ready.
        </p>
      </div>
      <SetupWizard
        accountEmail={owner.user.email}
        name={owner.user.name}
        contexts={owner.businesses.map((b) => ({ key: b.key, name: b.name }))}
        telegramLinked={Boolean(owner.user.telegram_chat_id)}
      />
    </div>
  );
}
