import { GarminConnect } from "garmin-connect";

/**
 * Unofficial Garmin Connect access. Logs in with the user's Garmin email +
 * password (community library — not an official API, so shapes are defensive
 * and everything degrades to null on failure). One login per call for now.
 */

export interface GarminActivity {
  name: string;
  type: string;
  date: string; // local ISO-ish from Garmin
  distanceKm: number | null;
  durationMin: number | null;
}

export interface GarminSnapshot {
  steps: number | null;
  sleepHours: number | null;
  restingHr: number | null;
  bodyBattery: number | null; // most-recent 0–100
  stress: number | null; // average 0–100 for the day
  activities: GarminActivity[];
}

const GC_API = "https://connectapi.garmin.com";

async function login(username: string, password: string): Promise<GarminConnect> {
  const gc = new GarminConnect({ username, password });
  await gc.login();
  return gc;
}

/** Verify credentials by logging in (throws on failure). */
export async function verifyGarmin(username: string, password: string): Promise<void> {
  await login(username, password);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
/** Non-negative only (Garmin uses -1/-2 for "no data"). */
function pos(v: unknown): number | null {
  const n = num(v);
  return n != null && n >= 0 ? n : null;
}
function ymdLocal(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(d);
}

/**
 * A compact health snapshot for the brief / display / assistant. The daily user
 * summary is the richest single source (steps, true resting HR, stress, body
 * battery); sleep and activities come from their own calls.
 */
export async function garminSnapshot(username: string, password: string, now: Date = new Date()): Promise<GarminSnapshot> {
  const gc = await login(username, password);
  const dateStr = ymdLocal(now);

  const profile = (await gc.getUserProfile().catch(() => null)) as { displayName?: string } | null;
  const displayName = profile?.displayName;

  const [summary, sleep, activities] = await Promise.all([
    displayName
      ? (gc
          .get(`${GC_API}/usersummary-service/usersummary/daily/${displayName}`, { params: { calendarDate: dateStr } })
          .catch(() => null) as Promise<Record<string, unknown> | null>)
      : Promise.resolve(null),
    gc.getSleepData(now).catch(() => null) as Promise<Record<string, unknown> | null>,
    gc.getActivities(0, 3).catch(() => []),
  ]);

  const sleepSecs =
    num((sleep?.dailySleepDTO as Record<string, unknown> | undefined)?.sleepTimeSeconds) ??
    num(sleep?.sleepTimeSeconds) ??
    num(summary?.sleepingSeconds);

  return {
    steps: pos(summary?.totalSteps),
    sleepHours: sleepSecs != null ? Math.round((sleepSecs / 3600) * 10) / 10 : null,
    restingHr: pos(summary?.restingHeartRate),
    bodyBattery: pos(summary?.bodyBatteryMostRecentValue),
    stress: pos(summary?.averageStressLevel),
    activities: (activities ?? []).slice(0, 3).map((a) => ({
      name: a.activityName ?? "Activity",
      type: (a.activityType?.typeKey ?? "").replace(/_/g, " "),
      date: a.startTimeLocal ?? "",
      distanceKm: num(a.distance) != null ? Math.round((a.distance / 1000) * 100) / 100 : null,
      durationMin: num(a.duration) != null ? Math.round(a.duration / 60) : null,
    })),
  };
}
