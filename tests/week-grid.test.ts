import { describe, it, expect } from "vitest";
import { packLanes } from "@/lib/display/data";

function byTitle(events: ReturnType<typeof packLanes>, title: string) {
  const e = events.find((x) => x.title === title);
  if (!e) throw new Error(`missing ${title}`);
  return e;
}

describe("packLanes", () => {
  it("gives non-overlapping events a single lane each", () => {
    const out = packLanes([
      { title: "A", startMin: 540, endMin: 600 }, // 09:00-10:00
      { title: "B", startMin: 600, endMin: 660 }, // 10:00-11:00 (touches, not overlapping)
    ]);
    expect(byTitle(out, "A").lane).toBe(0);
    expect(byTitle(out, "B").lane).toBe(0);
    expect(byTitle(out, "A").lanes).toBe(1);
    expect(byTitle(out, "B").lanes).toBe(1);
  });

  it("puts two overlapping events side by side", () => {
    const out = packLanes([
      { title: "A", startMin: 540, endMin: 600 }, // 09:00-10:00
      { title: "B", startMin: 570, endMin: 630 }, // 09:30-10:30 overlaps A
    ]);
    const a = byTitle(out, "A");
    const b = byTitle(out, "B");
    expect(a.lane).not.toBe(b.lane);
    expect(a.lanes).toBe(2);
    expect(b.lanes).toBe(2);
  });

  it("reuses a freed lane rather than growing indefinitely", () => {
    // A and B overlap (need 2 lanes); C starts after A ends, so it can reuse A's lane.
    const out = packLanes([
      { title: "A", startMin: 540, endMin: 570 }, // 09:00-09:30
      { title: "B", startMin: 550, endMin: 620 }, // 09:10-10:20 overlaps A
      { title: "C", startMin: 580, endMin: 610 }, // 09:40-10:10 starts after A ends
    ]);
    const a = byTitle(out, "A");
    const c = byTitle(out, "C");
    expect(c.lane).toBe(a.lane); // reused A's lane, not a 3rd one
  });

  it("three mutually overlapping events get three lanes", () => {
    const out = packLanes([
      { title: "A", startMin: 540, endMin: 630 },
      { title: "B", startMin: 540, endMin: 630 },
      { title: "C", startMin: 540, endMin: 630 },
    ]);
    const lanes = new Set(out.map((e) => e.lane));
    expect(lanes.size).toBe(3);
    expect(out.every((e) => e.lanes === 3)).toBe(true);
  });

  it("separate (non-overlapping) clusters don't share a lane count", () => {
    // Morning cluster: 2 overlapping events → needs 2 lanes.
    // Afternoon: 1 single event, far later → should NOT be forced into 2 lanes.
    const out = packLanes([
      { title: "A", startMin: 540, endMin: 600 },
      { title: "B", startMin: 550, endMin: 610 },
      { title: "C", startMin: 900, endMin: 960 },
    ]);
    expect(byTitle(out, "A").lanes).toBe(2);
    expect(byTitle(out, "C").lanes).toBe(1);
    expect(byTitle(out, "C").lane).toBe(0);
  });

  it("handles an empty list", () => {
    expect(packLanes([])).toEqual([]);
  });
});
