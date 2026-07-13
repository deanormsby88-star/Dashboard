import { describe, it, expect } from "vitest";
import { describeSymbol, layeringSuggestion } from "@/lib/weather";

describe("describeSymbol", () => {
  it("maps met.no symbol codes, stripping day/night", () => {
    expect(describeSymbol("clearsky_day")).toBe("Clear");
    expect(describeSymbol("partlycloudy_night")).toBe("Partly cloudy");
    expect(describeSymbol("rain")).toBe("Rain");
    expect(describeSymbol("heavyrainshowers_day")).toBe("Heavy rain");
    expect(describeSymbol("lightthunderrain")).toBe("Thunderstorms");
  });
});

describe("layeringSuggestion", () => {
  it("flags a cold day", () => {
    expect(layeringSuggestion(4, 12, false)).toMatch(/Cold/);
  });
  it("flags a chilly start on a warm day", () => {
    expect(layeringSuggestion(6, 24, false)).toMatch(/chilly start/i);
  });
  it("warns about rain when wet", () => {
    expect(layeringSuggestion(14, 19, true)).toMatch(/rain about/i);
  });
  it("keeps a hot dry day light with no rain warning", () => {
    const s = layeringSuggestion(20, 33, false);
    expect(s).toMatch(/Hot/);
    expect(s).not.toMatch(/rain/i);
  });
});
