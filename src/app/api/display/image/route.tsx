import { ImageResponse } from "next/og";
import { type NextRequest } from "next/server";
import { getUserById } from "@/lib/db/repo";
import { verifyDisplayToken } from "@/lib/display/token";
import { buildDisplayData, type DisplayOptions } from "@/lib/display/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INK = "#000000";
const PAPER = "#ffffff";

function size(v: string | null, fallback: number): number {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(1280, Math.max(200, n)) : fallback;
}

/** A light bordered section (schedule / tasks). */
function Section({ title, count, lines, empty, grow }: { title: string; count: number; lines: string[]; empty: string; grow?: boolean }) {
  return (
    <div style={{ ...(grow ? { flex: 1 } : {}), display: "flex", flexDirection: "column", border: `3px solid ${INK}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `2px solid ${INK}`, paddingBottom: 6, marginBottom: 8 }}>
        <div style={{ display: "flex", fontSize: 18, fontWeight: 800, letterSpacing: 2 }}>{title}</div>
        <div style={{ display: "flex", fontSize: 18, fontWeight: 800 }}>{String(count)}</div>
      </div>
      {lines.length ? (
        lines.map((l, i) => <div key={i} style={{ display: "flex", fontSize: 21, fontWeight: 500, marginBottom: 5 }}>{l}</div>)
      ) : (
        <div style={{ display: "flex", fontSize: 18, fontWeight: 500 }}>{empty}</div>
      )}
    </div>
  );
}

/** A titled list card; `dark` inverts it (white-on-black) for contrast. */
function InfoCard({ title, lines, empty, dark, last }: { title: string; lines: string[]; empty: string; dark?: boolean; last?: boolean }) {
  const fg = dark ? PAPER : INK;
  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", ...(dark ? { backgroundColor: INK, color: PAPER } : { border: `3px solid ${INK}` }), borderRadius: 10, padding: 14, marginBottom: last ? 0 : 12 }}>
      <div style={{ display: "flex", fontSize: 16, fontWeight: 800, letterSpacing: 2, borderBottom: `2px solid ${fg}`, paddingBottom: 6, marginBottom: 8 }}>{title}</div>
      {lines.length ? (
        lines.map((l, i) => <div key={i} style={{ display: "flex", fontSize: 18, fontWeight: 500, marginBottom: 5 }}>{l}</div>)
      ) : (
        <div style={{ display: "flex", fontSize: 16, fontWeight: 500 }}>{empty}</div>
      )}
    </div>
  );
}

/** Trim a line so it fits the narrow right column. */
function clip(s: string, n = 34): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
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

  const w = size(url.searchParams.get("w"), 800);
  const h = size(url.searchParams.get("h"), 480);

  const lat = parseFloat(url.searchParams.get("lat") ?? "");
  const lon = parseFloat(url.searchParams.get("lon") ?? "");
  const opts: DisplayOptions =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon, place: url.searchParams.get("place") ?? undefined }
      : {};

  const d = await buildDisplayData(owner, new Date(), opts);
  const schedule = d.schedule === "No meetings today" ? [] : d.schedule.split("\n");
  const tasks = d.tasks === "Nothing due today" ? [] : d.tasks.split("\n").map((t) => t.replace(/^•\s*/, ""));
  const priorities = d.priorities ? d.priorities.split("\n").map((l) => clip(l)) : [];
  const chase = d.chase ? d.chase.split("\n").map((l) => clip(l)) : [];

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", backgroundColor: PAPER, color: INK, padding: 24, fontFamily: "sans-serif" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 36, fontWeight: 800 }}>DeanOS</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 20, fontWeight: 700 }}>{d.date}</div>
            <div style={{ display: "flex", fontSize: 13, fontWeight: 500 }}>Updated {d.updated}</div>
          </div>
        </div>

        {/* Weather bar (dark) — or a plain rule if weather is unavailable */}
        {d.weather ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: INK, color: PAPER, borderRadius: 10, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8, marginTop: 10, marginBottom: 12 }}>
            <div style={{ display: "flex", fontSize: 19, fontWeight: 700 }}>{d.weather_place}</div>
            <div style={{ display: "flex", fontSize: 19, fontWeight: 500 }}>{d.weather}</div>
          </div>
        ) : (
          <div style={{ display: "flex", height: 4, backgroundColor: INK, marginTop: 8, marginBottom: 14 }} />
        )}

        {/* Two-column body */}
        <div style={{ display: "flex", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 3, marginRight: 16 }}>
            <Section title="TODAY" count={d.meetings_today} lines={schedule.slice(0, 5)} empty="Nothing scheduled" grow />
            <Section title="DUE TODAY" count={d.tasks_due_today} lines={tasks.slice(0, 4)} empty="Nothing due" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 2 }}>
            <InfoCard title="FOCUS TODAY" lines={priorities} empty="No priorities set" dark />
            <InfoCard title="CHASE" lines={chase} empty="Nobody owes you" last />
          </div>
        </div>
      </div>
    ),
    { width: w, height: h, headers: { "cache-control": "public, max-age=300" } }
  );
}
