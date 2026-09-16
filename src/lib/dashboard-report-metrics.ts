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

export type TrendBucket = "week" | "month";

function periodKey(dateISO: string, bucket: TrendBucket): string {
  if (bucket === "month") return dateISO.slice(0, 7);
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

export type TrendGroupSeries = {
  key: string;
  label: string;
  points: { period: string; value: number | null }[];
};

export type TrendReport = { periods: string[]; series: TrendGroupSeries[] };

/**
 * Group-level trend over time: each athlete contributes their single best
 * value per time bucket (so one heavily-tested athlete can't skew a bucket),
 * then buckets are averaged per caller-defined group — e.g. "40-yard time,
 * averaged by position, week over week" instead of a single snapshot.
 */
export function groupedTrend(
  metric: ReportMetric,
  athleteIds: string[],
  tests: TestRow[],
  repMaxes: RepMax[],
  groupOf: (athleteId: string) => { key: string; label: string } | null,
  bucket: TrendBucket = "week",
): TrendReport {
  const byGroupPeriod = new Map<string, Map<string, number[]>>();
  const groupLabels = new Map<string, string>();
  const periodSet = new Set<string>();

  for (const athleteId of athleteIds) {
    const g = groupOf(athleteId);
    if (!g) continue;
    groupLabels.set(g.key, g.label);
    const series = reportSeries(metric, athleteId, tests, repMaxes);
    const perPeriod = new Map<string, number>();
    for (const p of series) {
      const pk = periodKey(p.date, bucket);
      const cur = perPeriod.get(pk);
      if (cur == null || (metric.lowerIsBetter ? p.value < cur : p.value > cur))
        perPeriod.set(pk, p.value);
    }
    let groupMap = byGroupPeriod.get(g.key);
    if (!groupMap) {
      groupMap = new Map();
      byGroupPeriod.set(g.key, groupMap);
    }
    for (const [pk, v] of perPeriod) {
      periodSet.add(pk);
      const arr = groupMap.get(pk) ?? [];
      arr.push(v);
      groupMap.set(pk, arr);
    }
  }

  const periods = Array.from(periodSet).sort();
  const series: TrendGroupSeries[] = Array.from(byGroupPeriod.entries())
    .map(([key, periodMap]) => ({
      key,
      label: groupLabels.get(key) ?? key,
      points: periods.map((pk) => {
        const vals = periodMap.get(pk);
        return {
          period: pk,
          value: vals && vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null,
        };
      }),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { periods, series };
}
