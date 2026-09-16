// Shared metric catalog + per-athlete series builder for the Athlete/Team
// dashboard reports. Unifies two data sources into one "reportable metric"
// concept: logged test results (weekly measurements) and rep_maxes-derived
// estimated 1RMs (PRs), so both can be picked from the same filter UI.
import type { TestRow, RepMax, CustomTestType } from "@/lib/queries";
import { TEST_TYPES } from "@/lib/domain";

export type ReportMetric = {
  key: string; // "test:<test_type>" | "pr:<exercise_name>"
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  group: string;
};

export type ReportPoint = { date: string; value: number };
export type FlaggedPoint = ReportPoint & { isPR: boolean };

export function testReportMetrics(customTypes: CustomTestType[]): ReportMetric[] {
  const seen = new Set<string>();
  const out: ReportMetric[] = [];
  for (const t of TEST_TYPES) {
    seen.add(t.value);
    out.push({
      key: `test:${t.value}`,
      label: t.label,
      unit: t.unit,
      lowerIsBetter: t.lowerIsBetter,
      group: t.group,
    });
  }
  for (const c of customTypes) {
    if (seen.has(c.value)) continue;
    seen.add(c.value);
    out.push({
      key: `test:${c.value}`,
      label: c.label,
      unit: c.unit,
      lowerIsBetter: c.lower_is_better,
      group: c.group_name || "Custom",
    });
  }
  return out;
}

export function prReportMetrics(repMaxes: RepMax[]): ReportMetric[] {
  const names = Array.from(new Set(repMaxes.map((r) => r.exercise_name))).sort();
  return names.map((n) => ({
    key: `pr:${n}`,
    label: n,
    unit: "lb",
    lowerIsBetter: false,
    group: "PRs (est. 1RM)",
  }));
}

export function allReportMetrics(
  customTypes: CustomTestType[],
  repMaxes: RepMax[],
): ReportMetric[] {
  return [...testReportMetrics(customTypes), ...prReportMetrics(repMaxes)];
}

function est1RM(load: number, reps: number) {
  return reps > 1 ? load * (1 + reps / 30) : load;
}

/** Best value per date for one athlete + metric, ascending by date. */
export function reportSeries(
  metric: ReportMetric,
  athleteId: string,
  tests: TestRow[],
  repMaxes: RepMax[],
): ReportPoint[] {
  const map = new Map<string, number>();
  const consider = (date: string, value: number) => {
    const cur = map.get(date);
    if (cur == null || (metric.lowerIsBetter ? value < cur : value > cur)) map.set(date, value);
  };
  if (metric.key.startsWith("test:")) {
    const testType = metric.key.slice(5);
    for (const t of tests) {
      if (t.athlete_id === athleteId && t.test_type === testType)
        consider(t.test_date, Number(t.value));
    }
  } else if (metric.key.startsWith("pr:")) {
    const exerciseName = metric.key.slice(3);
    for (const r of repMaxes) {
      if (r.athlete_id === athleteId && r.exercise_name === exerciseName)
        consider(r.tested_at, est1RM(Number(r.load), r.reps));
    }
  }
  return Array.from(map.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Marks each point as a PR the moment it beats every prior point (running best). */
export function withPRFlags(series: ReportPoint[], lowerIsBetter: boolean): FlaggedPoint[] {
  let best: number | null = null;
  return series.map((p) => {
    const isPR = best == null || (lowerIsBetter ? p.value < best : p.value > best);
    if (isPR) best = p.value;
    return { ...p, isPR };
  });
}

export function average(series: ReportPoint[]): number | null {
  if (!series.length) return null;
  return series.reduce((s, p) => s + p.value, 0) / series.length;
}

export type ReportWindow = "30d" | "90d" | "season" | "career";

export function filterByWindow<T extends ReportPoint>(series: T[], w: ReportWindow): T[] {
  if (w === "career") return series;
  if (w === "season") {
    const y = new Date().getUTCFullYear();
    return series.filter((p) => p.date >= `${y}-01-01`);
  }
  const days = w === "30d" ? 30 : 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  return series.filter((p) => p.date >= cutoffISO);
}

/** Heatmap cell shading: PR beats "better than personal average" beats "near/below average". */
export type CellTone = "pr" | "up" | "down" | "flat" | "empty";

export function cellTone(
  value: number | null,
  avg: number | null,
  lowerIsBetter: boolean,
  isPR?: boolean,
): CellTone {
  if (value == null) return "empty";
  if (isPR) return "pr";
  if (avg == null) return "flat";
  const diff = lowerIsBetter ? avg - value : value - avg;
  const pct = diff / (Math.abs(avg) || 1);
  if (pct > 0.02) return "up";
  if (pct < -0.02) return "down";
  return "flat";
}

export const CELL_TONE_CLASS: Record<CellTone, string> = {
  pr: "bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold ring-1 ring-inset ring-amber-500/40",
  up: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  down: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  flat: "bg-muted/40 text-foreground",
  empty: "text-muted-foreground/30",
};

/** Percentile of `value` within `pool` (0-100, higher = better position). */
export function percentileRank(
  pool: number[],
  value: number,
  lowerIsBetter: boolean,
): number | null {
  if (!pool.length) return null;
  const better = pool.filter((v) => (lowerIsBetter ? v < value : v > value)).length;
  return Math.max(0, Math.min(100, ((pool.length - better) / pool.length) * 100));
}
