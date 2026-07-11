import LoginForm from "@/components/LoginForm";

export const metadata = { title: "Sign in — DeanOS" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in space-y-8">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-900 text-xl font-bold text-white shadow-soft dark:bg-white dark:text-slate-900">
            D
          </div>
          <h1 className="text-2xl font-bold tracking-tight">DeanOS</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Private executive operating system
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
