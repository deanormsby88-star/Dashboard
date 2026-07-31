import { ImageResponse } from "next/og";
import { type NextRequest } from "next/server";
import { getUserById } from "@/lib/db/repo";
import { verifyDisplayToken } from "@/lib/display/token";
import { buildDisplayData } from "@/lib/display/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function size(v: string | null, fallback: number): number {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(1280, Math.max(200, n)) : fallback;
}

function Section({ title, accent, count, lines, empty }: { title: string; accent: string; count: number; lines: string[]; empty: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", backgroundColor: "#111c33", borderRadius: 16, padding: 16, marginBottom: 14, borderLeft: `6px solid ${accent}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", fontSize: 15, fontWeight: 700, letterSpacing: 1, color: accent }}>{title}</div>
        <div style={{ display: "flex", fontSize: 15, color: "#7f93b0" }}>{String(count)}</div>
      </div>
      {lines.length ? (
        lines.map((l, i) => (
          <div key={i} style={{ display: "flex", fontSize: 19, color: "#e5edf7", marginBottom: 4 }}>{l}</div>
        ))
      ) : (
        <div style={{ display: "flex", fontSize: 18, color: "#64748b" }}>{empty}</div>
      )}
    </div>
  );
}

function Stat({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, backgroundColor: "#111c33", borderRadius: 16, padding: 12, marginRight: 10 }}>
      <div style={{ display: "flex", fontSize: 40, fontWeight: 800, color }}>{String(n)}</div>
      <div style={{ display: "flex", fontSize: 13, color: "#9fb2cc", textAlign: "center" }}>{label}</div>
    </div>
  );
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1];
  const token = (bearer ?? url.searchParams.get("token") ?? "").trim();
  const userId = token ? verifyDisplayToken(token) : null;
  if (!userId) return new Response("unauthorized", { status: 401 });
  const owner = await getUserById(userId).catch(() => null);
  if (!owner) return new Response("unauthorized", { status: 401 });

  const w = size(url.searchParams.get("w"), 480);
  const h = size(url.searchParams.get("h"), 480);
  const d = await buildDisplayData(owner);
  const schedule = d.schedule === "No meetings today" ? [] : d.schedule.split("\n");
  const tasks = d.tasks === "Nothing due today" ? [] : d.tasks.split("\n").map((t) => t.replace(/^•\s*/, ""));

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", backgroundColor: "#0b1220", padding: 26, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 800, color: "#ffffff" }}>DeanOS</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 18, color: "#c3d0e6" }}>{d.date}</div>
            <div style={{ display: "flex", fontSize: 13, color: "#64748b" }}>Updated {d.updated}</div>
          </div>
        </div>

        <Section title="TODAY" accent="#3b82f6" count={d.meetings_today} lines={schedule.slice(0, 4)} empty="Nothing scheduled" />
        <Section title="DUE TODAY" accent="#22c55e" count={d.tasks_due_today} lines={tasks.slice(0, 3)} empty="Nothing due" />

        <div style={{ display: "flex", marginTop: "auto" }}>
          <Stat label="You owe" n={d.you_owe} color="#f87171" />
          <Stat label="Team owes you" n={d.team_owes_you} color="#fbbf24" />
          <Stat label="Clients owe you" n={d.others_owe_you} color="#38bdf8" />
        </div>
      </div>
    ),
    { width: w, height: h, headers: { "cache-control": "public, max-age=60" } }
  );
}
