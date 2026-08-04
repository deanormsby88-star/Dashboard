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
  activities: GarminActivity[];
}

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

/** A compact health snapshot for the brief / display. */
export async function garminSnapshot(username: string, password: string, now: Date = new Date()): Promise<GarminSnapshot> {
  const gc = await login(username, password);

  const [steps, sleep, hr, activities] = await Promise.all([
    gc.getSteps(now).catch(() => null),
    gc.getSleepData(now).catch(() => null) as Promise<Record<string, unknown> | null>,
    gc.getHeartRate(now).catch(() => null) as Promise<Record<string, unknown> | null>,
    gc.getActivities(0, 3).catch(() => []),
  ]);

  const sleepSecs =
    num((sleep?.dailySleepDTO as Record<string, unknown> | undefined)?.sleepTimeSeconds) ?? num(sleep?.sleepTimeSeconds);
  const restingHr = num(hr?.restingHeartRate);

  return {
    steps: num(steps),
    sleepHours: sleepSecs != null ? Math.round((sleepSecs / 3600) * 10) / 10 : null,
    restingHr,
    activities: (activities ?? []).slice(0, 3).map((a) => ({
      name: a.activityName ?? "Activity",
      type: (a.activityType?.typeKey ?? "").replace(/_/g, " "),
      date: a.startTimeLocal ?? "",
      distanceKm: num(a.distance) != null ? Math.round((a.distance / 1000) * 100) / 100 : null,
      durationMin: num(a.duration) != null ? Math.round(a.duration / 60) : null,
    })),
  };
}
