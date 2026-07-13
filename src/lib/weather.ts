/**
 * Today's weather from the Norwegian Met Institute (met.no / Yr) — free, no
 * API key, widely rated among the most accurate global sources. Defaults to
 * Pierneef Park, Johannesburg; override with WEATHER_LAT / WEATHER_LON env.
 *
 * met.no requires an identifying User-Agent and coordinates to ≤4 decimals.
 */

const DEFAULT_LAT = -26.1307; // Pierneef Park, Randburg, Johannesburg
const DEFAULT_LON = 28.0018;
const USER_AGENT = "DeanOS/1.0 (https://deanos-nu.vercel.app; deano@heya.team)";

export interface TodayWeather {
  summary: string;
  tempMin: number;
  tempMax: number;
  precipMm: number;
  wet: boolean;
  suggestion: string;
}

/** met.no symbol code (e.g. "partlycloudy_day") → short description. */
export function describeSymbol(code: string): string {
  const c = code.replace(/_(day|night|polartwilight)$/, "");
  if (c === "clearsky") return "Clear";
  if (c === "fair") return "Mostly sunny";
  if (c === "partlycloudy") return "Partly cloudy";
  if (c === "cloudy") return "Overcast";
  if (c.includes("fog")) return "Foggy";
  if (c.includes("thunder")) return "Thunderstorms";
  if (c.includes("sleet")) return "Sleet";
  if (c.includes("snow")) return "Snow";
  if (c.includes("heavyrain")) return "Heavy rain";
  if (c.includes("rainshowers")) return "Rain showers";
  if (c.includes("lightrain")) return "Light rain";
  if (c.includes("rain")) return "Rain";
  return "Mixed";
}

/** Rank a symbol by how weather-significant it is, to pick the day's headline. */
function severity(code: string): number {
  const c = code.replace(/_(day|night|polartwilight)$/, "");
  if (c.includes("thunder")) return 6;
  if (c.includes("heavyrain") || c.includes("snow") || c.includes("sleet")) return 5;
  if (c.includes("rain")) return 4;
  if (c.includes("drizzle")) return 3;
  if (c.includes("fog")) return 3;
  if (c === "cloudy") return 2;
  if (c === "partlycloudy") return 1;
  return 0; // fair / clearsky
}

/** Practical what-to-wear line from the day's range and whether it'll be wet. */
export function layeringSuggestion(tempMin: number, tempMax: number, wet: boolean): string {
  const bits: string[] = [];
  if (tempMax <= 14) bits.push("Cold — a proper jacket or coat");
  else if (tempMax <= 19) bits.push("Cool — a jacket or jersey");
  else if (tempMax <= 25) bits.push("Mild — light layers");
  else if (tempMax <= 30) bits.push("Warm — light clothing");
  else bits.push("Hot — keep it light, water and sun cover");

  if (tempMin < 8 && tempMax >= 20) bits.push("chilly start, so layer for the morning");
  else if (tempMin < 8) bits.push("cold morning — warm layer early");

  if (wet) bits.push("rain about — take a jacket/umbrella");

  return bits.join("; ") + ".";
}

function localDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

export async function getTodayWeather(now: Date = new Date()): Promise<TodayWeather | null> {
  const lat = process.env.WEATHER_LAT ?? String(DEFAULT_LAT);
  const lon = process.env.WEATHER_LON ?? String(DEFAULT_LON);
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat}&lon=${lon}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      properties?: {
        timeseries?: Array<{
          time: string;
          data: {
            instant?: { details?: { air_temperature?: number } };
            next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
          };
        }>;
      };
    };
    const series = data.properties?.timeseries ?? [];
    const today = now.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

    const temps: number[] = [];
    let precipMm = 0;
    let headline = "clearsky_day";
    let topSeverity = -1;
    let matched = 0;

    for (const e of series) {
      if (localDate(e.time) !== today) continue;
      matched++;
      const t = e.data.instant?.details?.air_temperature;
      if (typeof t === "number") temps.push(t);
      const nx = e.data.next_1_hours;
      if (nx?.details?.precipitation_amount) precipMm += nx.details.precipitation_amount;
      const sym = nx?.summary?.symbol_code;
      if (sym && severity(sym) > topSeverity) {
        topSeverity = severity(sym);
        headline = sym;
      }
    }
    if (matched === 0 || temps.length === 0) return null;

    const tempMin = Math.round(Math.min(...temps));
    const tempMax = Math.round(Math.max(...temps));
    const roundedMm = Math.round(precipMm * 10) / 10;
    const wet = roundedMm >= 0.3 || topSeverity >= 3;

    return {
      summary: describeSymbol(headline),
      tempMin,
      tempMax,
      precipMm: roundedMm,
      wet,
      suggestion: layeringSuggestion(tempMin, tempMax, wet),
    };
  } catch {
    return null;
  }
}
