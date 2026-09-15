// Shared calculation helpers used by Reports so its numbers match
// Leaderboards / Athlete Dashboards exactly. Every report chart, table,
// KPI, CSV row, and PDF section MUST derive its values from these
// functions — no per-report ad hoc math.
//
// Data source rules:
//   • Lift data comes from the `lifts` table (via liftsQO).
//     The `lifts` table is populated exclusively by the
//     `trg_rack_log_to_lift` trigger, which only materializes rows for
//     rack_set_logs with status='completed' AND approval_status IN
//     ('auto','approved'). Pending or rejected sets never reach `lifts`,
//     so anything computed from `lifts` is guaranteed approved-only,
//     matching the leaderboard / athlete dashboard rule.
//   • Test data comes from the `tests` table (via testsQO), matching
//     leaderboards.

import type { LiftRow, TestRow, Athlete } from "@/lib/queries";
import { bestByAthlete, bestLiftByAthlete, type DateWindow } from "@/lib/metrics";
import { testTypeMeta } from "@/lib/domain";

export type ReportRange = { from: string; to: string };
export function inRange(d: string, r: ReportRange) {
  return d >= r.from && d <= r.to;
}
export function toWindow(r: ReportRange): DateWindow {
  return { from: r.from, to: r.to };
}

/** Approved lifts for a set of athletes in a date range (single source of truth). */
export function scopedLifts(lifts: LiftRow[], athleteIds: Set<string> | string[], range: ReportRange): LiftRow[] {
  const ids = athleteIds instanceof Set ? athleteIds : new Set(athleteIds);
  return lifts.filter((l) => ids.has(l.athlete_id) && inRange(l.lift_date, range));
}

export function scopedTests(tests: TestRow[], athleteIds: Set<string> | string[], range: ReportRange): TestRow[] {
  const ids = athleteIds instanceof Set ? athleteIds : new Set(athleteIds);
  return tests.filter((t) => ids.has(t.athlete_id) && inRange(t.test_date, range));
}

/** Current PR (best load) for one athlete + exercise in range — same rule leaderboards use. */
export function currentPR(lifts: LiftRow[], athleteId: string, exercise: string, range: ReportRange) {
  const best = bestLiftByAthlete(lifts, exercise, toWindow(range)).get(athleteId);
  return best ? { load: best.value, date: best.row.lift_date, reps: best.row.reps ?? 1 } : null;
}

/** Best test result for one athlete + test type in range — same rule leaderboards use. */
export function currentTestBest(tests: TestRow[], athleteId: string, testType: string, range: ReportRange) {
  const meta = testTypeMeta(testType);
  const best = bestByAthlete(tests, testType, meta.lowerIsBetter, toWindow(range)).get(athleteId);
  return best ? { value: Number(best.value), unit: meta.unit, date: best.test_date } : null;
}

/** Total training volume (Σ load × reps) across a filtered lift set. */
export function totalVolume(lifts: LiftRow[]): number {
  let v = 0;
  for (const l of lifts) {
    if (l.load == null || l.reps == null) continue;
    v += Number(l.load) * Number(l.reps);
  }
  return v;
}

export type ExerciseAggRow = {
  exercise: string;
  entries: number;
  athletes: number;
  maxLoad: number | null;
  avgLoad: number | null;
  volume: number;
};

/** Per-exercise rollup used by team reports & analytics — sorted by entries. */
export function exerciseBreakdown(lifts: LiftRow[]): ExerciseAggRow[] {
  const map = new Map<string, { entries: number; athletes: Set<string>; maxLoad: number; sumLoad: number; loadCount: number; volume: number }>();
  for (const l of lifts) {
    const cur = map.get(l.exercise) ?? { entries: 0, athletes: new Set<string>(), maxLoad: 0, sumLoad: 0, loadCount: 0, volume: 0 };
    cur.entries += 1;
    cur.athletes.add(l.athlete_id);
    if (l.load != null) {
      cur.maxLoad = Math.max(cur.maxLoad, Number(l.load));
      cur.sumLoad += Number(l.load); cur.loadCount += 1;
      if (l.reps != null) cur.volume += Number(l.load) * Number(l.reps);
    }
    map.set(l.exercise, cur);
  }
  return [...map.entries()]
    .map(([exercise, v]) => ({
      exercise,
      entries: v.entries,
      athletes: v.athletes.size,
      maxLoad: v.maxLoad || null,
      avgLoad: v.loadCount ? Math.round((v.sumLoad / v.loadCount) * 10) / 10 : null,
      volume: v.volume,
    }))
    .sort((a, b) => b.entries - a.entries);
}

/** Weekly best-load-per-exercise time series (Sunday-start weeks). */
export function weeklyTopLoadSeries(lifts: LiftRow[], exercises: string[]): Array<Record<string, number | string>> {
  const buckets = new Map<string, Map<string, number>>(); // wk -> ex -> maxLoad
  const wanted = new Set(exercises);
  for (const l of lifts) {
    if (l.load == null || !wanted.has(l.exercise)) continue;
    const d = new Date(l.lift_date); d.setDate(d.getDate() - d.getDay());
    const wk = d.toISOString().slice(0, 10);
    let ex = buckets.get(wk); if (!ex) { ex = new Map(); buckets.set(wk, ex); }
    ex.set(l.exercise, Math.max(ex.get(l.exercise) ?? 0, Number(l.load)));
  }
  const rows: Array<Record<string, number | string>> = [];
  for (const [wk, ex] of buckets) {
    const row: Record<string, number | string> = { date: wk };
    for (const [name, v] of ex) row[name] = v;
    rows.push(row);
  }
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** Per-athlete lift trend: date -> max load for each of the given exercises. */
export function athleteTrendSeries(lifts: LiftRow[], exercises: string[]): Array<Record<string, number | string>> {
  const wanted = new Set(exercises);
  const byDate = new Map<string, Record<string, number | string>>();
  for (const l of lifts) {
    if (!wanted.has(l.exercise) || l.load == null) continue;
    const row = byDate.get(l.lift_date) ?? { date: l.lift_date };
    const prev = (row[l.exercise] as number | undefined) ?? 0;
    row[l.exercise] = Math.max(prev, Number(l.load));
    byDate.set(l.lift_date, row);
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** Ordered list of exercises for an athlete, ranked by entry count. */
export function topExercisesFor(lifts: LiftRow[], limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const l of lifts) counts.set(l.exercise, (counts.get(l.exercise) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([e]) => e);
}

export function isEmpty(...arrs: Array<{ length: number }>): boolean {
  return arrs.every((a) => a.length === 0);
}

/** Roster resolution matching queries used elsewhere (primary team + athlete_teams). */
export function rosterFor(teamId: string, athletes: Athlete[], athleteTeams: { athlete_id: string; team_id: string }[]) {
  const ids = new Set<string>();
  for (const a of athletes) if (a.team_id === teamId) ids.add(a.id);
  for (const at of athleteTeams) if (at.team_id === teamId) ids.add(at.athlete_id);
  return athletes.filter((a) => ids.has(a.id));
}
