/** Centered Second brand frame shared by the sign-in and password pages. */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in space-y-8">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-900 text-xl font-bold text-white shadow-soft dark:bg-white dark:text-slate-900">
            S
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Second</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Your AI 2IC
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
