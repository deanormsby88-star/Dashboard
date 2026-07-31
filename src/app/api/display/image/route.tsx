import { ImageResponse } from "next/og";
import { type NextRequest } from "next/server";
import { getUserById } from "@/lib/db/repo";
import { verifyDisplayToken } from "@/lib/display/token";
import { buildDisplayData } from "@/lib/display/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INK = "#000000";
const PAPER = "#ffffff";

function size(v: string | null, fallback: number): number {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(1280, Math.max(200, n)) : fallback;
}

/** A bordered section — high contrast, no colour dependence. */
function Section({ title, count, lines, empty }: { title: string; count: number; lines: string[]; empty: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", border: `3px solid ${INK}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `2px solid ${INK}`, paddingBottom: 6, marginBottom: 8 }}>
        <div style={{ display: "flex", fontSize: 17, fontWeight: 800, letterSpacing: 2 }}>{title}</div>
        <div style={{ display: "flex", fontSize: 17, fontWeight: 800 }}>{String(count)}</div>
      </div>
      {lines.length ? (
        lines.map((l, i) => (
          <div key={i} style={{ display: "flex", fontSize: 20, fontWeight: 500, marginBottom: 5 }}>{l}</div>
        ))
      ) : (
        <div style={{ display: "flex", fontSize: 18, fontWeight: 500, fontStyle: "italic" }}>{empty}</div>
      )}
    </div>
  );
}

function Stat({ label, n, last }: { label: string; n: number; last?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, border: `3px solid ${INK}`, borderRadius: 10, paddingTop: 10, paddingBottom: 10, marginRight: last ? 0 : 10 }}>
      <div style={{ display: "flex", fontSize: 44, fontWeight: 800, lineHeight: 1 }}>{String(n)}</div>
      <div style={{ display: "flex", fontSize: 13, fontWeight: 700, letterSpacing: 1, marginTop: 4, textTransform: "uppercase" }}>{label}</div>
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
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", backgroundColor: PAPER, color: INK, padding: 24, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 800 }}>DeanOS</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 19, fontWeight: 700 }}>{d.date}</div>
            <div style={{ display: "flex", fontSize: 13, fontWeight: 500 }}>Updated {d.updated}</div>
          </div>
        </div>
        <div style={{ display: "flex", height: 4, backgroundColor: INK, marginTop: 8, marginBottom: 14 }} />

        <Section title="TODAY" count={d.meetings_today} lines={schedule.slice(0, 4)} empty="Nothing scheduled" />
        <Section title="DUE TODAY" count={d.tasks_due_today} lines={tasks.slice(0, 3)} empty="Nothing due" />

        <div style={{ display: "flex", marginTop: "auto" }}>
          <Stat label="You owe" n={d.you_owe} />
          <Stat label="Team owes you" n={d.team_owes_you} />
          <Stat label="Clients owe you" n={d.others_owe_you} last />
        </div>
      </div>
    ),
    { width: w, height: h, headers: { "cache-control": "public, max-age=60" } }
  );
}
