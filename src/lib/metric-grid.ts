// The numbers behind the metric "test days" table: every athlete down the side,
// one column per day somebody was tested. Nothing is averaged across days.
// Each box is the athlete's best result that day, plus the change from their own
// previous test. The group row compares only the athletes tested on both days.
import { addDays } from "@/lib/weigh-ins";

export type GridPoint = { date: string; value: number };
export type GridSeries = { id: string; points: GridPoint[] };
export type GridCell = {
  value: number;
  /** This result minus the athlete's own previous test. Null on their first test. */
  change: number | null;
  /** true = improved, false = got worse, null = first test or no change. */
  better: boolean | null;
};
export type GroupDay = {
  /** Average of everyone tested that day. */
  avg: number;
  tested: number;
  /** Average change of the athletes tested on both this day and the one before. */
  change: number | null;
  /** How many athletes that change is based on. */
  changeN: number;
};

/** A group change from fewer athletes than this is just noise, so it shows a dash. */
export const MIN_GROUP_OVERLAP = 3;

/** Decimal places shown for a unit: pounds to a tenth, everything else to a hundredth. */
export function decimalsFor(unit: string): number {
  return unit === "lb" ? 1 : 2;
}

function roundTo(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function formatValue(v: number, unit: string): string {
  const places = decimalsFor(unit);
  return places === 1 ? String(roundTo(v, 1)) : v.toFixed(places);
}

export function formatDelta(change: number, unit: string): string {
  const places = decimalsFor(unit);
  const r = roundTo(change, places);
  if (r === 0) return "0";
  const text = places === 1 ? String(Math.abs(r)) : Math.abs(r).toFixed(places);
  return `${r > 0 ? "+" : "−"}${text}`;
}

export function buildMetricGrid(series: GridSeries[], lowerIsBetter: boolean, unit: string) {
  const places = decimalsFor(unit);
  const dateSet = new Set<string>();
  const cells = new Map<string, Map<string, GridCell>>();

  for (const s of series) {
    // One best result per day, in case the caller passed several.
    const bestByDate = new Map<string, number>();
    for (const p of s.points) {
      const cur = bestByDate.get(p.date);
      if (cur == null || (lowerIsBetter ? p.value < cur : p.value > cur)) {
        bestByDate.set(p.date, p.value);
      }
    }
    const dates = Array.from(bestByDate.keys()).sort();
    const row = new Map<string, GridCell>();
    let prev: number | null = null;
    for (const date of dates) {
      const value = bestByDate.get(date)!;
      const change = prev == null ? null : roundTo(value - prev, places);
      row.set(date, {
        value,
        change,
        better: change == null || change === 0 ? null : lowerIsBetter ? change < 0 : change > 0,
      });
      prev = value;
      dateSet.add(date);
    }
    cells.set(s.id, row);
  }

  const datesAsc = Array.from(dateSet).sort();
  const group = new Map<string, GroupDay>();
  datesAsc.forEach((date, i) => {
    const prevDate = i > 0 ? datesAsc[i - 1] : null;
    let sum = 0;
    let tested = 0;
    let changeSum = 0;
    let changeN = 0;
    for (const row of cells.values()) {
      const c = row.get(date);
      if (!c) continue;
      sum += c.value;
      tested += 1;
      const before = prevDate ? row.get(prevDate) : undefined;
      if (before) {
        changeSum += c.value - before.value;
        changeN += 1;
      }
    }
    if (!tested) return;
    group.set(date, {
      avg: sum / tested,
      tested,
      change: changeN >= MIN_GROUP_OVERLAP ? roundTo(changeSum / changeN, places) : null,
      changeN,
    });
  });

  return { datesAsc, cells, group };
}

/** How much the newest test improved on the one before (negative = got worse). */
export function latestImprovement(
  row: Map<string, GridCell> | undefined,
  lowerIsBetter: boolean,
): number | null {
  if (!row || !row.size) return null;
  const newest = Array.from(row.keys()).sort().pop()!;
  const change = row.get(newest)!.change;
  if (change == null) return null;
  return lowerIsBetter ? -change : change;
}

export const GRID_RANGES = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7", label: "Week" },
  { value: "30", label: "Month" },
  { value: "90", label: "3 Months" },
  { value: "180", label: "6 Months" },
  { value: "365", label: "Year" },
] as const;

/**
 * The test days to show: inside the time range, then only the newest `count` of
 * them (null = no limit). Newest first.
 */
export function visibleDates(
  datesAsc: string[],
  range: string,
  count: number | null,
  today: string,
): string[] {
  let inRange = datesAsc;
  if (range === "today") inRange = datesAsc.filter((d) => d === today);
  else if (range !== "all") {
    const cutoff = addDays(today, -Number(range));
    inRange = datesAsc.filter((d) => d >= cutoff);
  }
  const newestFirst = inRange.slice().reverse();
  return count == null ? newestFirst : newestFirst.slice(0, count);
}
