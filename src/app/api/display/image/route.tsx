import { ImageResponse } from "next/og";
import { type NextRequest } from "next/server";
import { getUserById } from "@/lib/db/repo";
import { verifyDisplayToken } from "@/lib/display/token";
import { buildWeekCalendarData } from "@/lib/display/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INK = "#000000";
const PAPER = "#ffffff";

function size(v: string | null, fallback: number): number {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(1280, Math.max(200, n)) : fallback;
}

/** Trim a line so it fits a narrow day column on one row (no wrap). */
function clip(s: string, n: number): string {
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

  const week = await buildWeekCalendarData(owner, new Date());
  const clipLen = w >= 800 ? 16 : 12;

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", backgroundColor: PAPER, color: INK, padding: 20, fontFamily: "sans-serif" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 800 }}>{week.rangeLabel}</div>
          <div style={{ display: "flex", fontSize: 13, fontWeight: 500 }}>Updated {week.updated}</div>
        </div>
        <div style={{ display: "flex", height: 4, backgroundColor: INK, marginTop: 8, marginBottom: 12 }} />

        {/* 7-column week grid */}
        <div style={{ display: "flex", flex: 1 }}>
          {week.days.map((day, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                marginRight: i < 6 ? 8 : 0,
                border: `2px solid ${INK}`,
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  paddingTop: 6,
                  paddingBottom: 6,
                  ...(day.isToday ? { backgroundColor: INK, color: PAPER } : {}),
                }}
              >
                <div style={{ display: "flex", fontSize: 14, fontWeight: 800, letterSpacing: 1 }}>{day.dayName.toUpperCase()}</div>
                <div style={{ display: "flex", fontSize: 12, fontWeight: 500 }}>{day.dayLabel}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", padding: 6, flex: 1 }}>
                {day.events.length ? (
                  day.events.slice(0, 9).map((e, j) => (
                    <div key={j} style={{ display: "flex", flexDirection: "column", marginBottom: 5 }}>
                      <div style={{ display: "flex", fontSize: 10, fontWeight: 700 }}>{e.time}</div>
                      <div style={{ display: "flex", fontSize: 11, fontWeight: 500, lineHeight: 1.15 }}>{clip(e.title, clipLen)}</div>
                    </div>
                  ))
                ) : (
                  <div style={{ display: "flex", fontSize: 10, fontWeight: 500, color: "#999999" }}>—</div>
                )}
                {day.events.length > 9 && (
                  <div style={{ display: "flex", fontSize: 10, fontWeight: 700 }}>+{day.events.length - 9} more</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    { width: w, height: h, headers: { "cache-control": "no-store, max-age=0" } }
  );
}
