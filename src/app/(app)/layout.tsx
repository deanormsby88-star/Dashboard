import NavLinks from "@/components/NavLinks";
import LogoutButton from "@/components/LogoutButton";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:flex md:gap-0 md:p-3">
      <aside
        className="border-b border-slate-200/60 bg-white/70 px-3 py-3 backdrop-blur
                   dark:border-white/5 dark:bg-white/[0.03]
                   md:sticky md:top-3 md:mr-3 md:flex md:h-[calc(100vh-1.5rem)] md:w-60 md:shrink-0
                   md:flex-col md:rounded-3xl md:border md:border-white/60 md:shadow-soft md:dark:border-white/5"
      >
        <div className="mb-2 flex items-center gap-3 px-3 md:mb-6 md:py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-900 text-sm font-bold text-white dark:bg-white dark:text-slate-900">
            D
          </div>
          <div>
            <div className="text-sm font-bold leading-tight tracking-tight">DeanOS</div>
            <div className="text-xs text-slate-400 dark:text-slate-500">Executive OS</div>
          </div>
        </div>
        <NavLinks />
        <div className="hidden md:mt-auto md:block">
          <LogoutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 animate-fade-in px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
