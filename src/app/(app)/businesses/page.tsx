import { ensureOwner } from "@/lib/db/repo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Businesses — DeanOS" };

const SCOPE: Record<string, string> = {
  heya: "Operations, clients, recruitment, HR, finance, IT, and facilities.",
  jic: "Clients, orders, suppliers, finance, cash flow, product, and logistics.",
  personal: "Family, health, personal finance, travel, and life administration.",
};

export default async function BusinessesPage() {
  const owner = await ensureOwner();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Businesses</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every record in DeanOS is scoped to one of these contexts. Heya and JIC records are
          never mixed.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {owner.businesses.map((b) => (
          <div key={b.id} className="card p-4">
            <h2 className="font-semibold">{b.name}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{SCOPE[b.key]}</p>
            <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
              Todoist project:{" "}
              {b.todoist_project_id ? (
                <span className="font-mono">{b.todoist_project_id}</span>
              ) : (
                "Inbox (no validated project ID yet)"
              )}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
