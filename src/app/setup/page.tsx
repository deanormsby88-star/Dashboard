import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import SetupWizard from "@/components/SetupWizard";
import BrandTile from "@/components/BrandTile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up — Second" };

export default async function SetupPage() {
  const owner = await getSessionUser();
  if (!owner) redirect("/login");
  if (owner.user.setup_completed_at) redirect("/");

  return (
    <div className="mx-auto min-h-screen max-w-xl px-4 py-12">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-4">
          <BrandTile size="md" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome to Second</h1>
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
