import { describe, expect, it } from "vitest";
import {
  addDays,
  changeBetweenDates,
  dailyAverages,
  dailySeries,
  easternToday,
  formatChange,
  formatWeight,
  recentWeekStarts,
  summarizeAthlete,
  trendOf,
  weekStartOf,
  type WeighIn,
} from "@/lib/weigh-ins";

const w = (log_date: string, value: number): WeighIn => ({ athlete_id: "a", log_date, value });

// 2026-10-26 is a Monday. Weeks below start 10-26, 11-02, 11-09, 11-16.
describe("weeks run Monday to Sunday", () => {
  it("finds the Monday of any day", () => {
    expect(weekStartOf("2026-11-02")).toBe("2026-11-02"); // Monday
    expect(weekStartOf("2026-11-08")).toBe("2026-11-02"); // Sunday belongs to the week before
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09");
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28"); // across the new year
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("lists the most recent weeks, oldest first, ending with this week", () => {
    expect(recentWeekStarts("2026-11-04", 3)).toEqual(["2026-10-19", "2026-10-26", "2026-11-02"]);
  });
});

describe("one number per day", () => {
  it("averages several weigh-ins on the same day", () => {
    const daily = dailyAverages([w("2026-11-02", 180), w("2026-11-02", 182), w("2026-11-03", 190)]);
    expect(daily.get("2026-11-02")).toBe(181);
    expect(daily.get("2026-11-03")).toBe(190);
  });
});

describe("weight over time", () => {
  it("gives one point per day for one athlete, oldest first", () => {
    const rows = [
      { athlete_id: "a", log_date: "2026-11-03", value: 190 },
      { athlete_id: "a", log_date: "2026-11-02", value: 180 },
      { athlete_id: "a", log_date: "2026-11-02", value: 182 },
      { athlete_id: "b", log_date: "2026-11-02", value: 250 },
    ];
    expect(dailySeries(rows, "a")).toEqual([
      { date: "2026-11-02", value: 181 },
      { date: "2026-11-03", value: 190 },
    ]);
    expect(dailySeries(rows, "nobody")).toEqual([]);
  });
});

describe("a week counts only with 3 different days", () => {
  it("counts a week with weigh-ins on 3 days", () => {
    const s = summarizeAthlete([w("2026-11-02", 180), w("2026-11-04", 181), w("2026-11-06", 182)]);
    expect(s.weeks).toHaveLength(1);
    expect(s.weeks[0]).toMatchObject({ days: 3, counted: true, avg: 181 });
  });

  it("does not count 2 days, but still shows the average and the day count", () => {
    const s = summarizeAthlete([w("2026-11-02", 180), w("2026-11-04", 182)]);
    expect(s.weeks[0]).toMatchObject({ days: 2, counted: false, avg: 181, change: null });
  });

  it("does not count many weigh-ins on only 2 days", () => {
    const s = summarizeAthlete([
      w("2026-11-02", 180),
      w("2026-11-02", 181),
      w("2026-11-02", 182),
      w("2026-11-03", 180),
      w("2026-11-03", 181),
    ]);
    expect(s.weeks[0]).toMatchObject({ days: 2, counted: false });
  });

  it("gives each day one vote in the weekly average", () => {
    // Monday weighed four times at 180, Tuesday and Wednesday once at 190.
    const s = summarizeAthlete([
      w("2026-11-02", 180),
      w("2026-11-02", 180),
      w("2026-11-02", 180),
      w("2026-11-02", 180),
      w("2026-11-03", 190),
      w("2026-11-04", 190),
    ]);
    expect(s.weeks[0].avg).toBeCloseTo((180 + 190 + 190) / 3, 6); // not (4*180 + 2*190) / 6
  });

  it("puts a Sunday weigh-in in the week that just ended", () => {
    const s = summarizeAthlete([w("2026-11-01", 180), w("2026-11-02", 181)]);
    expect(s.weeks.map((x) => [x.weekStart, x.days])).toEqual([
      ["2026-10-26", 1],
      ["2026-11-02", 1],
    ]);
  });
});

describe("empty weeks", () => {
  it("shows a missed week as an empty week with no average", () => {
    const s = summarizeAthlete([
      w("2026-10-26", 180),
      w("2026-10-27", 180),
      w("2026-10-28", 180),
      w("2026-11-09", 181),
    ]);
    expect(s.weeks.map((x) => x.weekStart)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"]);
    expect(s.weeks[1]).toMatchObject({ days: 0, avg: null, counted: false, change: null });
  });

  it("can run through the current week even when nothing was logged yet", () => {
    const s = summarizeAthlete([w("2026-10-26", 180)], "2026-11-09");
    expect(s.weeks).toHaveLength(3);
    expect(s.weeks[2]).toMatchObject({ days: 0, avg: null });
  });

  it("returns nothing for an athlete with no weigh-ins", () => {
    expect(summarizeAthlete([])).toEqual({
      weeks: [],
      firstCounted: null,
      latestCounted: null,
      netChange: null,
    });
  });
});

describe("weekly change and net change", () => {
  // Week 1 counted at 180, week 2 only 2 days (does not count), week 3 counted at 182.
  const history = [
    w("2026-10-26", 180),
    w("2026-10-27", 180),
    w("2026-10-28", 180),
    w("2026-11-02", 185),
    w("2026-11-03", 185),
    w("2026-11-09", 181),
    w("2026-11-10", 182),
    w("2026-11-11", 183),
  ];

  it("compares a counted week to the last counted week, skipping weeks that did not count", () => {
    const s = summarizeAthlete(history);
    expect(s.weeks[0].change).toBeNull(); // first counted week has nothing before it
    expect(s.weeks[1].change).toBeNull(); // did not count
    expect(s.weeks[2].change).toBeCloseTo(2, 6); // 182 vs 180, not vs the 185 week
  });

  it("measures net change from the first counted week to the latest", () => {
    const s = summarizeAthlete(history);
    expect(s.firstCounted?.weekStart).toBe("2026-10-26");
    expect(s.latestCounted?.weekStart).toBe("2026-11-09");
    expect(s.netChange).toBeCloseTo(2, 6);
  });

  it("has no net change until two weeks have counted", () => {
    const s = summarizeAthlete(history.slice(0, 3));
    expect(s.netChange).toBeNull();
  });

  it("shows a loss as a negative change", () => {
    const s = summarizeAthlete([
      w("2026-10-26", 200),
      w("2026-10-27", 200),
      w("2026-10-28", 200),
      w("2026-11-02", 196),
      w("2026-11-03", 196),
      w("2026-11-04", 196),
    ]);
    expect(s.weeks[1].change).toBeCloseTo(-4, 6);
    expect(s.netChange).toBeCloseTo(-4, 6);
  });
});

describe("change between two dates", () => {
  const history = [w("2026-10-26", 180), w("2026-10-26", 182), w("2026-11-09", 186)];

  it("uses each day's average", () => {
    expect(changeBetweenDates(history, "2026-10-26", "2026-11-09")).toEqual({
      from: 181,
      to: 186,
      change: 5,
    });
  });

  it("says so, instead of guessing, when a day has no weigh-in", () => {
    expect(changeBetweenDates(history, "2026-10-26", "2026-11-01")).toEqual({
      from: 181,
      to: null,
      change: null,
    });
  });
});

describe("colors and labels", () => {
  it("up is green, down is red, and a wash is flat", () => {
    expect(trendOf(1.4)).toBe("up");
    expect(trendOf(-0.8)).toBe("down");
    expect(trendOf(0.04)).toBe("flat");
    expect(trendOf(-0.04)).toBe("flat");
    expect(trendOf(null)).toBeNull();
  });

  it("formats weights and changes to one decimal", () => {
    expect(formatWeight(181.04)).toBe("181.0");
    expect(formatWeight(null)).toBe("—");
    expect(formatChange(1.44)).toBe("+1.4");
    expect(formatChange(-0.8)).toBe("−0.8");
    expect(formatChange(0.02)).toBe("0.0");
    expect(formatChange(null)).toBe("—");
  });
});

describe("today on the Eastern clock", () => {
  it("does not roll to tomorrow in the evening", () => {
    expect(easternToday(new Date("2026-11-03T02:30:00Z"))).toBe("2026-11-02"); // 9:30pm Monday
    expect(easternToday(new Date("2026-11-03T15:00:00Z"))).toBe("2026-11-03");
  });
});
