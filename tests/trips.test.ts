import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sortTrips, tripDates, tripDays, tripPhase, tripTiming } from "../src/lib/server/trips";

const T = (name: string, start_date: string, end_date: string | null) => ({ name, start_date, end_date });
const today = "2026-11-28";

describe("trip dates", () => {
  it("formats ranges compactly", () => {
    expect(tripDates(T("a", "2026-12-12", "2026-12-24"))).toBe("12 – 24 Dec 2026");
    expect(tripDates(T("a", "2026-11-28", "2026-12-03"))).toBe("28 Nov – 3 Dec 2026");
    expect(tripDates(T("a", "2026-12-30", "2027-01-04"))).toBe("30 Dec 2026 – 4 Jan 2027");
    expect(tripDates(T("a", "2026-12-12", null))).toBe("12 Dec 2026");
  });
  it("knows now / upcoming / past and the length", () => {
    expect(tripPhase(T("a", "2026-11-26", "2026-11-30"), today)).toBe("now");
    expect(tripPhase(T("a", "2026-12-12", "2026-12-24"), today)).toBe("upcoming");
    expect(tripPhase(T("a", "2026-10-01", null), today)).toBe("past");
    expect(tripDays(T("a", "2026-12-12", "2026-12-24"))).toBe(13);
    expect(tripTiming(T("a", "2026-11-26", "2026-11-30"), today)).toBe("Day 3 of 5");
    expect(tripTiming(T("a", "2026-12-12", "2026-12-24"), today)).toBe("13 days · in 2 weeks");
  });
  it("sorts: now, upcoming soonest first, past most recent first", () => {
    const s = sortTrips([T("old", "2025-01-01", "2025-01-05"), T("far", "2027-03-01", null), T("next", "2026-12-12", "2026-12-24"),
      T("recent", "2026-10-20", "2026-10-25"), T("here", "2026-11-27", "2026-11-29")], today);
    expect(s.now.map((t) => t.name)).toEqual(["here"]);
    expect(s.upcoming.map((t) => t.name)).toEqual(["next", "far"]);
    expect(s.past.map((t) => t.name)).toEqual(["recent", "old"]);
  });
});
