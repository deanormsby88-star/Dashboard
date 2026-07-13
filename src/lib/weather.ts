/**
 * Today's weather from Open-Meteo (free, no API key). Defaults to
 * Johannesburg; override with WEATHER_LAT / WEATHER_LON env if Dean moves.
 */

const DEFAULT_LAT = -26.2041; // Johannesburg
const DEFAULT_LON = 28.0473;

export interface TodayWeather {
  summary: string;
  tempMin: number;
  tempMax: number;
  precipProb: number;
  suggestion: string;
}

/** WMO weather code → short human description. */
export function describeWeatherCode(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Mostly sunny";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95) return "Thunderstorms";
  return "Mixed";
}

/** Practical what-to-wear line from the day's range and rain chance. */
export function layeringSuggestion(tempMin: number, tempMax: number, precipProb: number, code: number): string {
  const bits: string[] = [];
  if (tempMax <= 14) bits.push("Cold — a proper jacket or coat");
  else if (tempMax <= 19) bits.push("Cool — a jacket or jersey");
  else if (tempMax <= 25) bits.push("Mild — light layers");
  else if (tempMax <= 30) bits.push("Warm — light clothing");
  else bits.push("Hot — keep it light, water and sun cover");

  if (tempMin < 8 && tempMax >= 20) bits.push("chilly start, so layer for the morning");
  else if (tempMin < 8) bits.push("cold morning — warm layer early");

  const wet = precipProb >= 50 || (code >= 51 && code <= 82) || code >= 95;
  if (wet) bits.push("rain likely — take a jacket/umbrella");

  return bits.join("; ") + ".";
}

export async function getTodayWeather(): Promise<TodayWeather | null> {
  const lat = process.env.WEATHER_LAT ? Number(process.env.WEATHER_LAT) : DEFAULT_LAT;
  const lon = process.env.WEATHER_LON ? Number(process.env.WEATHER_LON) : DEFAULT_LON;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=Africa%2FJohannesburg&forecast_days=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      daily?: {
        weathercode?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
      };
    };
    const d = data.daily;
    if (!d?.temperature_2m_max?.length) return null;
    const code = d.weathercode?.[0] ?? 0;
    const tempMax = Math.round(d.temperature_2m_max[0]);
    const tempMin = Math.round(d.temperature_2m_min?.[0] ?? tempMax);
    const precipProb = d.precipitation_probability_max?.[0] ?? 0;
    return {
      summary: describeWeatherCode(code),
      tempMin,
      tempMax,
      precipProb,
      suggestion: layeringSuggestion(tempMin, tempMax, precipProb, code),
    };
  } catch {
    return null;
  }
}
