import { describe, it, expect } from "vitest";
import { describeWeatherCode, layeringSuggestion } from "@/lib/weather";

describe("describeWeatherCode", () => {
  it("maps common WMO codes", () => {
    expect(describeWeatherCode(0)).toBe("Clear");
    expect(describeWeatherCode(3)).toBe("Overcast");
    expect(describeWeatherCode(63)).toBe("Rain");
    expect(describeWeatherCode(95)).toBe("Thunderstorms");
  });
});

describe("layeringSuggestion", () => {
  it("flags a cold day", () => {
    expect(layeringSuggestion(4, 12, 10, 3)).toMatch(/Cold/);
  });
  it("flags a chilly start on a warm day", () => {
    expect(layeringSuggestion(6, 24, 0, 0)).toMatch(/chilly start/i);
  });
  it("warns about rain when likely", () => {
    expect(layeringSuggestion(14, 19, 80, 61)).toMatch(/rain likely/i);
  });
  it("keeps a hot day light with no rain warning", () => {
    const s = layeringSuggestion(20, 33, 0, 0);
    expect(s).toMatch(/Hot/);
    expect(s).not.toMatch(/rain/i);
  });
});
