import NavLinks from "@/components/NavLinks";
import LogoutButton from "@/components/LogoutButton";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 md:sticky md:top-0 md:flex md:h-screen md:w-56 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
        <div className="mb-2 flex items-center justify-between md:mb-6">
          <div className="px-3">
            <div className="text-lg font-bold tracking-tight">DeanOS</div>
            <div className="text-xs text-slate-400 dark:text-slate-500">Executive OS</div>
          </div>
        </div>
        <NavLinks />
        <div className="hidden md:mt-auto md:block">
          <LogoutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
