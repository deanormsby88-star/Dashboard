import LoginForm from "@/components/LoginForm";

export const metadata = { title: "Sign in — DeanOS" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
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
