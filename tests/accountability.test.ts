import { describe, it, expect } from "vitest";
import {
  ASSERTIVE_THRESHOLDS,
  businessDaysStale,
  isDueOrOverdue,
  loopNeedsNudge,
} from "@/lib/accountability/staleness";
import type { Commitment } from "@/lib/types";

function commit(partial: Partial<Commitment>): Commitment {
  return {
    id: "c1",
    user_id: "u1",
    business_id: null,
    meeting_id: null,
    direction: "to_dean",
    text: "the thing",
    person_id: null,
    person_name: "Sam",
    company: null,
    date_made: null,
    due_date: null,
    status: "open",
    confidence: null,
    linked_task_id: null,
    source_system: null,
    source_record_id: null,
    source_url: null,
    dedup_key: "k",
    created_at: new Date("2026-07-20T09:00:00Z"), // a Monday
    ...partial,
  };
}

const MON = new Date("2026-07-20T09:00:00Z");

describe("businessDaysStale", () => {
  it("counts weekdays since the commitment was made", () => {
    const c = commit({ date_made: new Date("2026-07-20T09:00:00Z") }); // Mon
    expect(businessDaysStale(c, new Date("2026-07-23T09:00:00Z"))).toBe(3); // Thu
  });

  it("skips the weekend", () => {
    const c = commit({ date_made: new Date("2026-07-17T09:00:00Z") }); // Fri
    expect(businessDaysStale(c, new Date("2026-07-20T09:00:00Z"))).toBe(1); // next Mon
  });

  it("falls back to created_at when date_made is null", () => {
    const c = commit({ date_made: null, created_at: new Date("2026-07-20T09:00:00Z") });
    expect(businessDaysStale(c, new Date("2026-07-22T09:00:00Z"))).toBe(2);
  });
});

describe("isDueOrOverdue", () => {
  it("is true for a past due date", () => {
    expect(isDueOrOverdue(new Date("2026-07-19T00:00:00Z"), MON)).toBe(true);
  });
  it("is true for today", () => {
    expect(isDueOrOverdue(new Date("2026-07-20T23:00:00Z"), MON)).toBe(true);
  });
  it("is false for a future due date", () => {
    expect(isDueOrOverdue(new Date("2026-07-24T00:00:00Z"), MON)).toBe(false);
  });
  it("is false when there is no due date", () => {
    expect(isDueOrOverdue(null, MON)).toBe(false);
  });
});

describe("loopNeedsNudge (Assertive)", () => {
  const now = new Date("2026-07-24T09:00:00Z"); // Fri

  it("never nudges done or cancelled loops", () => {
    expect(loopNeedsNudge(commit({ status: "done", date_made: new Date("2026-07-01") }), now)).toBe(false);
    expect(loopNeedsNudge(commit({ status: "cancelled", date_made: new Date("2026-07-01") }), now)).toBe(false);
  });

  it("nudges something you owe after 2 business days", () => {
    const made = new Date("2026-07-22T09:00:00Z"); // Wed → Fri = 2 business days
    expect(loopNeedsNudge(commit({ direction: "by_dean", date_made: made }), now)).toBe(true);
  });

  it("does not nudge something you owe at 1 business day", () => {
    const made = new Date("2026-07-23T09:00:00Z"); // Thu → Fri = 1 day
    expect(loopNeedsNudge(commit({ direction: "by_dean", date_made: made }), now)).toBe(false);
  });

  it("waits longer (4 business days) for things an EXTERNAL contact owes you", () => {
    const made3 = new Date("2026-07-21T09:00:00Z"); // Tue → Fri = 3 days: not yet
    expect(loopNeedsNudge(commit({ direction: "to_dean", date_made: made3 }), now)).toBe(false);
    const made4 = new Date("2026-07-20T09:00:00Z"); // Mon → Fri = 4 days: nudge
    expect(loopNeedsNudge(commit({ direction: "to_dean", date_made: made4 }), now)).toBe(true);
  });

  it("chases your own team sooner (2 business days)", () => {
    const made2 = new Date("2026-07-22T09:00:00Z"); // Wed → Fri = 2 days
    // External contact at 2 days: not yet.
    expect(loopNeedsNudge(commit({ direction: "to_dean", date_made: made2 }), now, undefined, false)).toBe(false);
    // Teammate at 2 days: nudge.
    expect(loopNeedsNudge(commit({ direction: "to_dean", date_made: made2 }), now, undefined, true)).toBe(true);
  });

  it("nudges an overdue you-owe even if only just made", () => {
    const made = new Date("2026-07-24T08:00:00Z"); // today
    const due = new Date("2026-07-23T00:00:00Z"); // yesterday
    expect(loopNeedsNudge(commit({ direction: "by_dean", date_made: made, due_date: due }), now)).toBe(true);
  });

  it("uses the configured thresholds", () => {
    const made = new Date("2026-07-23T09:00:00Z"); // 1 business day
    expect(
      loopNeedsNudge(commit({ direction: "by_dean", date_made: made }), now, {
        owedByYouDays: 1,
        owedToYouDays: 2,
        owedToYouByTeamDays: 1,
      })
    ).toBe(true);
  });

  it("ASSERTIVE_THRESHOLDS: owe 2, external 4, team 2", () => {
    expect(ASSERTIVE_THRESHOLDS).toEqual({ owedByYouDays: 2, owedToYouDays: 4, owedToYouByTeamDays: 2 });
  });
});
