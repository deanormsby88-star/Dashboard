/**
 * Current weather + today's high/low from Open-Meteo (free, no API key).
 * Defaults to Johannesburg; override with lat/lon. Returns null on any failure
 * so the display degrades gracefully.
 */

export interface Weather {
  now: number;
  hi: number;
  lo: number;
  desc: string;
  place: string;
}

export const DEFAULT_LOCATION = { lat: -26.2041, lon: 28.0473, place: "Johannesburg" };

/** WMO weather code → short label. */
export function wmoText(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code >= 56 && code <= 57) return "Freezing drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code >= 66 && code <= 67) return "Freezing rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code >= 96) return "Thunderstorm";
  return "—";
}

export async function getWeather(
  lat: number = DEFAULT_LOCATION.lat,
  lon: number = DEFAULT_LOCATION.lon,
  place: string = DEFAULT_LOCATION.place
): Promise<Weather | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min` +
    `&timezone=Africa%2FJohannesburg&forecast_days=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
      daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
    };
    const now = d.current?.temperature_2m;
    const hi = d.daily?.temperature_2m_max?.[0];
    const lo = d.daily?.temperature_2m_min?.[0];
    if (![now, hi, lo].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return { now: Math.round(now!), hi: Math.round(hi!), lo: Math.round(lo!), desc: wmoText(d.current?.weather_code ?? -1), place };
  } catch {
    return null;
  }
}

/** One-line summary, e.g. "Partly cloudy · 14° · H 24° L 11°". */
export function weatherLine(w: Weather | null): string {
  if (!w) return "";
  return `${w.desc} · ${w.now}° · H ${w.hi}° L ${w.lo}°`;
}
