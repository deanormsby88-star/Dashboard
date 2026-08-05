import { ImageResponse } from "next/og";
import { type NextRequest } from "next/server";
import { getUserById } from "@/lib/db/repo";
import { verifyDisplayToken } from "@/lib/display/token";
import { buildWeekCalendarData, type WeekGridEvent } from "@/lib/display/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INK = "#000000";
const PAPER = "#ffffff";
const GRID_LINE = "#bbbbbb";

function size(v: string | null, fallback: number): number {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(1280, Math.max(200, n)) : fallback;
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function fmtHour(h: number): string {
  return `${String(h % 24).padStart(2, "0")}:00`;
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

  // ── Layout geometry (all pixel-precise; the OG renderer needs real values,
  // not percentages, for absolutely-positioned children). ──────────────────
  const PAD = 16;
  const GUTTER = 44; // hour-label column
  const HEADER_H = 34;
  const ALLDAY_H = week.days.some((d) => d.allDay.length) ? 20 : 0;
  const hourCount = week.hourEnd - week.hourStart;
  const gridTop = PAD + HEADER_H + ALLDAY_H;
  const gridH = h - gridTop - PAD;
  const gridW = w - PAD * 2 - GUTTER;
  const dayW = gridW / 7;
  const pxPerMin = gridH / (hourCount * 60);
  const clipLen = Math.max(6, Math.floor(dayW / 6.5));

  function block(e: WeekGridEvent, key: number) {
    const top = Math.max(0, (e.startMin - week.hourStart * 60) * pxPerMin);
    const height = Math.max(12, (e.endMin - e.startMin) * pxPerMin - 1);
    const laneW = dayW / e.lanes - 2;
    const left = e.lane * (dayW / e.lanes) + 1;
    const showTime = height >= 24;
    return (
      <div
        key={key}
        style={{
          display: "flex",
          flexDirection: "column",
          position: "absolute",
          top,
          left,
          width: laneW,
          height,
          backgroundColor: INK,
          color: PAPER,
          borderRadius: 3,
          paddingLeft: 3,
          paddingRight: 3,
          paddingTop: 1,
          overflow: "hidden",
        }}
      >
        {showTime && (
          <div style={{ display: "flex", fontSize: 8, fontWeight: 700, lineHeight: 1.1 }}>
            {String(Math.floor(e.startMin / 60)).padStart(2, "0")}:{String(e.startMin % 60).padStart(2, "0")}
          </div>
        )}
        <div style={{ display: "flex", fontSize: 9, fontWeight: 600, lineHeight: 1.1 }}>{clip(e.title, clipLen)}</div>
      </div>
    );
  }

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", backgroundColor: PAPER, color: INK, padding: PAD, fontFamily: "sans-serif" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", height: HEADER_H }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 800 }}>{week.rangeLabel}</div>
          <div style={{ display: "flex", fontSize: 12, fontWeight: 500 }}>Updated {week.updated}</div>
        </div>

        {/* Day-of-week header row */}
        <div style={{ display: "flex" }}>
          <div style={{ display: "flex", width: GUTTER }} />
          {week.days.map((day, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: dayW,
                paddingTop: 3,
                paddingBottom: 3,
                ...(day.isToday ? { backgroundColor: INK, color: PAPER } : {}),
              }}
            >
              <div style={{ display: "flex", fontSize: 12, fontWeight: 800, letterSpacing: 1 }}>
                {day.dayName.toUpperCase()} {day.dayLabel}
              </div>
            </div>
          ))}
        </div>

        {/* All-day banner row (only rendered if any exist this week) */}
        {ALLDAY_H > 0 && (
          <div style={{ display: "flex", height: ALLDAY_H }}>
            <div style={{ display: "flex", width: GUTTER }} />
            {week.days.map((day, i) => (
              <div key={i} style={{ display: "flex", width: dayW, paddingLeft: 2, paddingRight: 2 }}>
                {day.allDay.length > 0 && (
                  <div style={{ display: "flex", backgroundColor: "#555555", color: PAPER, fontSize: 9, fontWeight: 600, borderRadius: 3, paddingLeft: 4, paddingRight: 4, width: "100%" }}>
                    {clip(day.allDay.join(", "), clipLen + 4)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Time grid */}
        <div style={{ display: "flex", flex: 1 }}>
          {/* Hour gutter */}
          <div style={{ display: "flex", flexDirection: "column", width: GUTTER }}>
            {Array.from({ length: hourCount }, (_, i) => (
              <div key={i} style={{ display: "flex", height: gridH / hourCount, alignItems: "flex-start" }}>
                <div style={{ display: "flex", fontSize: 9, fontWeight: 600, marginTop: -5 }}>{fmtHour(week.hourStart + i)}</div>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {week.days.map((day, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", position: "relative", width: dayW, height: gridH, borderLeft: `1px solid ${GRID_LINE}` }}>
              {Array.from({ length: hourCount }, (_, j) => (
                <div key={j} style={{ display: "flex", height: gridH / hourCount, borderTop: `1px solid ${GRID_LINE}` }} />
              ))}
              {day.timed.map((e, k) => block(e, k))}
            </div>
          ))}
        </div>
      </div>
    ),
    { width: w, height: h, headers: { "cache-control": "no-store, max-age=0" } }
  );
}
