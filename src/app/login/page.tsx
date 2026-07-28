export const metadata = { title: "Sign in — DeanOS" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  domain: "That account isn't part of an organisation approved for DeanOS. Use your work account.",
  not_configured: "Microsoft sign-in isn't configured yet. Contact your administrator.",
  oauth: "Microsoft sign-in was cancelled or failed. Please try again.",
  bad_state: "Your sign-in link expired. Please try again.",
  profile: "Couldn't read your Microsoft profile. Please try again.",
  exchange_failed: "Sign-in couldn't complete. Please try again.",
};

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  const error = searchParams.error ? ERRORS[searchParams.error] ?? "Sign-in failed." : null;
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in space-y-8">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-900 text-xl font-bold text-white shadow-soft dark:bg-white dark:text-slate-900">
            D
          </div>
          <h1 className="text-2xl font-bold tracking-tight">DeanOS</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Your AI chief of staff
          </p>
        </div>
        <div className="card space-y-4 p-6">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <a href="/api/auth/microsoft/login" className="btn-primary flex w-full items-center justify-center gap-2">
            Sign in with Microsoft
          </a>
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Use your work Microsoft 365 account. This connects your calendar and email.
          </p>
        </div>
      </div>
    </div>
  );
}
