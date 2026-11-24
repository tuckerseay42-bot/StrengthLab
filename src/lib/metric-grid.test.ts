import { describe, expect, it } from "vitest";
import {
  buildMetricGrid,
  formatDelta,
  formatValue,
  latestImprovement,
  MIN_GROUP_OVERLAP,
  visibleDates,
} from "./metric-grid";

const s = (id: string, pts: [string, number][]) => ({
  id,
  points: pts.map(([date, value]) => ({ date, value })),
});

describe("buildMetricGrid", () => {
  it("shows the change from the athlete's own previous test", () => {
    const g = buildMetricGrid([s("a", [["2026-09-01", 27], ["2026-10-01", 28.5]])], false, "in");
    expect(g.cells.get("a")!.get("2026-09-01")).toMatchObject({ change: null, better: null });
    expect(g.cells.get("a")!.get("2026-10-01")).toMatchObject({ change: 1.5, better: true });
  });

  it("counts a faster time as better", () => {
    const g = buildMetricGrid([s("a", [["2026-09-01", 5.1], ["2026-10-01", 4.9], ["2026-11-01", 5.0]])], true, "s");
    expect(g.cells.get("a")!.get("2026-10-01")).toMatchObject({ change: -0.2, better: true });
    expect(g.cells.get("a")!.get("2026-11-01")).toMatchObject({ change: 0.1, better: false });
  });

  it("compares to the previous test even when days in between had no test for that athlete", () => {
    const g = buildMetricGrid(
      [s("a", [["2026-09-01", 100], ["2026-11-01", 110]]), s("b", [["2026-10-01", 50]])],
      false,
      "lb",
    );
    expect(g.cells.get("a")!.get("2026-11-01")!.change).toBe(10);
    expect(g.datesAsc).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
  });

  it("keeps the best result when a day has several", () => {
    const g = buildMetricGrid([s("a", [["2026-09-01", 26], ["2026-09-01", 29], ["2026-09-01", 27]])], false, "in");
    expect(g.cells.get("a")!.get("2026-09-01")!.value).toBe(29);
  });

  it("treats a change that rounds to nothing as no change", () => {
    const g = buildMetricGrid([s("a", [["2026-09-01", 4.8], ["2026-10-01", 4.801]])], true, "s");
    expect(g.cells.get("a")!.get("2026-10-01")).toMatchObject({ change: 0, better: null });
  });
});

describe("group row", () => {
  const eight = (v: number) => Array.from({ length: 5 }, (_, i) => s("a" + i, [["2026-09-01", 100 + i], ["2026-10-01", 100 + i + v]]));

  it("averages everyone tested that day and counts them", () => {
    const g = buildMetricGrid(eight(0), false, "lb");
    expect(g.group.get("2026-09-01")).toMatchObject({ avg: 102, tested: 5 });
  });

  it("changes only by athletes tested on both days", () => {
    // 5 athletes tested both days, +10 each. Two extra tested only on day 2, much heavier.
    const series = [...eight(10), s("x", [["2026-10-01", 400]]), s("y", [["2026-10-01", 400]])];
    const g = buildMetricGrid(series, false, "lb");
    expect(g.group.get("2026-10-01")!.tested).toBe(7);
    expect(g.group.get("2026-10-01")!.change).toBe(10);
    expect(g.group.get("2026-10-01")!.changeN).toBe(5);
  });

  it("shows no change when fewer than 3 athletes were tested on both days", () => {
    expect(MIN_GROUP_OVERLAP).toBe(3);
    const g = buildMetricGrid(
      [s("a", [["2026-09-01", 100], ["2026-10-01", 110]]), s("b", [["2026-09-01", 100], ["2026-10-01", 120]]), s("c", [["2026-10-01", 90]])],
      false,
      "lb",
    );
    expect(g.group.get("2026-10-01")).toMatchObject({ tested: 3, change: null, changeN: 2 });
  });

  it("has no change on the first test day", () => {
    const g = buildMetricGrid(eight(5), false, "lb");
    expect(g.group.get("2026-09-01")!.change).toBeNull();
  });
});

describe("latestImprovement", () => {
  it("is positive when the newest test beat the one before, for either direction", () => {
    const up = buildMetricGrid([s("a", [["2026-09-01", 20], ["2026-10-01", 22]])], false, "in");
    expect(latestImprovement(up.cells.get("a"), false)).toBe(2);
    const fast = buildMetricGrid([s("a", [["2026-09-01", 5], ["2026-10-01", 4.8]])], true, "s");
    expect(latestImprovement(fast.cells.get("a"), true)).toBe(0.2);
  });
  it("is null with one test or none", () => {
    const one = buildMetricGrid([s("a", [["2026-09-01", 20]])], false, "in");
    expect(latestImprovement(one.cells.get("a"), false)).toBeNull();
    expect(latestImprovement(undefined, false)).toBeNull();
  });
});

describe("visibleDates", () => {
  const all = ["2026-06-01", "2026-09-01", "2026-10-01", "2026-11-01", "2026-11-20"];
  it("lists newest first", () => {
    expect(visibleDates(all, "all", null, "2026-11-24")).toEqual([
      "2026-11-20", "2026-11-01", "2026-10-01", "2026-09-01", "2026-06-01",
    ]);
  });
  it("takes only the newest N test days", () => {
    expect(visibleDates(all, "all", 2, "2026-11-24")).toEqual(["2026-11-20", "2026-11-01"]);
  });
  it("limits by time range, then by count", () => {
    expect(visibleDates(all, "30", null, "2026-11-24")).toEqual(["2026-11-20", "2026-11-01"]);
    expect(visibleDates(all, "90", null, "2026-11-24")).toEqual(["2026-11-20", "2026-11-01", "2026-10-01", "2026-09-01"]);
    expect(visibleDates(all, "30", 1, "2026-11-24")).toEqual(["2026-11-20"]);
  });
  it("today means only today", () => {
    expect(visibleDates(all, "today", null, "2026-11-20")).toEqual(["2026-11-20"]);
    expect(visibleDates(all, "today", null, "2026-11-24")).toEqual([]);
  });
});

describe("formatting", () => {
  it("shows pounds to a tenth without trailing zeros, others to a hundredth", () => {
    expect(formatValue(225, "lb")).toBe("225");
    expect(formatValue(227.54, "lb")).toBe("227.5");
    expect(formatValue(4.8, "s")).toBe("4.80");
  });
  it("signs changes", () => {
    expect(formatDelta(1.5, "in")).toBe("+1.50");
    expect(formatDelta(-0.2, "s")).toBe("−0.20");
    expect(formatDelta(10, "lb")).toBe("+10");
    expect(formatDelta(0, "lb")).toBe("0");
  });
});
