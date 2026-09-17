import { evaluate } from "mathjs";
import type { Athlete, TestRow, LiftRow, AttendanceRow, CustomMetric, MetricVariable, CustomTestType } from "@/lib/queries";
import { bwCoefficient, testTypeMeta as baseTestTypeMeta, percentImprovement } from "@/lib/domain";

function makeMetaResolver(customTypes: CustomTestType[] = []) {
  const map = new Map(customTypes.map((c) => [c.value, c]));
  return (v: string) => {
    const c = map.get(v);
    if (c) return { value: c.value, label: c.label, unit: c.unit, lowerIsBetter: c.lower_is_better, group: c.group_name };
    return baseTestTypeMeta(v);
  };
}

export type MetricRow = {
  athlete: Athlete;
  value: number;
  breakdown?: string;
  date: string;
};

export type DateWindow = { from?: string | null; to?: string | null };

function inWindow(date: string, w: DateWindow) {
  if (w.from && date < w.from) return false;
  if (w.to && date > w.to) return false;
  return true;
}

export function bestByAthlete(tests: TestRow[], testType: string, lowerIsBetter: boolean, w: DateWindow) {
  const map = new Map<string, TestRow>();
  for (const t of tests) {
    if (t.test_type !== testType) continue;
    if (!inWindow(t.test_date, w)) continue;
    const prev = map.get(t.athlete_id);
    if (!prev) { map.set(t.athlete_id, t); continue; }
    if (lowerIsBetter ? Number(t.value) < Number(prev.value) : Number(t.value) > Number(prev.value)) {
      map.set(t.athlete_id, t);
    }
  }
  return map;
}

type LiftMeasure = "load" | "time" | "height" | "speed";
function liftValue(l: LiftRow, m: LiftMeasure): number | null {
  // "speed" (mph) exercises log their reading in the load field, same as
  // weight lifts — the measurement kind is what tells them apart.
  const raw = m === "time" ? l.time_seconds : m === "height" ? l.distance_in : l.load;
  return raw == null ? null : Number(raw);
}

export function bestLiftByAthlete(lifts: LiftRow[], exerciseName: string, w: DateWindow, measurement: LiftMeasure = "load") {
  const target = exerciseName.trim().toLowerCase();
  const lowerIsBetter = measurement === "time";
  const map = new Map<string, { row: LiftRow; value: number }>();
  for (const l of lifts) {
    if ((l.exercise ?? "").trim().toLowerCase() !== target) continue;
    const v = liftValue(l, measurement);
    if (v == null) continue;
    if (!inWindow(l.lift_date, w)) continue;
    const prev = map.get(l.athlete_id);
    if (!prev || (lowerIsBetter ? v < prev.value : v > prev.value)) {
      map.set(l.athlete_id, { row: l, value: v });
    }
  }
  return map;
}


function firstAndLatest(tests: TestRow[], testType: string, w: DateWindow) {
  const map = new Map<string, { first: TestRow; latest: TestRow }>();
  const filtered = tests.filter((t) => t.test_type === testType && inWindow(t.test_date, w))
    .slice().sort((a, b) => a.test_date.localeCompare(b.test_date));
  for (const t of filtered) {
    const prev = map.get(t.athlete_id);
    if (!prev) map.set(t.athlete_id, { first: t, latest: t });
    else map.set(t.athlete_id, { first: prev.first, latest: t });
  }
  return map;
}

// Resolve one variable value for an athlete under a date window.
function resolveVar(v: MetricVariable, a: Athlete, tests: TestRow[], lifts: LiftRow[], w: DateWindow, testTypeMeta: (v: string) => { unit: string; lowerIsBetter: boolean }): number | null {
  if (v.source === "athlete") {
    const raw = (a as any)[v.key];
    if (raw == null) return null;
    return Number(raw);
  }
  if (v.source === "test") {
    const meta = testTypeMeta(v.key);
    if (v.agg === "latest" || v.agg === "first") {
      const pairs = firstAndLatest(tests, v.key, w).get(a.id);
      if (!pairs) return null;
      return Number(v.agg === "first" ? pairs.first.value : pairs.latest.value);
    }
    const best = bestByAthlete(tests, v.key, meta.lowerIsBetter, w).get(a.id);
    return best ? Number(best.value) : null;
  }
  if (v.source === "lift") {
    const best = bestLiftByAthlete(lifts, v.key, w).get(a.id);
    return best ? best.value : null;
  }

  return null;
}

export function computeMetric(
  metric: CustomMetric,
  athletes: Athlete[],
  tests: TestRow[],
  lifts: LiftRow[] = [],
  attendance: AttendanceRow[] = [],
  window: DateWindow = {},
  customTypes: CustomTestType[] = [],
): MetricRow[] {
  const testTypeMeta = makeMetaResolver(customTypes);
  const rows: MetricRow[] = [];
  const lower = metric.lower_is_better;
  const today = new Date().toISOString().slice(0, 10);

  if (metric.kind === "bodyweight") {
    for (const a of athletes) {
      if (a.bodyweight == null) continue;
      rows.push({ athlete: a, value: Number(a.bodyweight), date: today });
    }
  } else if (metric.kind === "test_value" && metric.test_type) {
    const meta = testTypeMeta(metric.test_type);
    const best = bestByAthlete(tests, metric.test_type, meta.lowerIsBetter, window);
    for (const a of athletes) {
      const t = best.get(a.id); if (!t) continue;
      rows.push({ athlete: a, value: Number(t.value), date: t.test_date });
    }
  } else if (metric.kind === "bw_coefficient" && metric.test_type) {
    const meta = testTypeMeta(metric.test_type);
    const best = bestByAthlete(tests, metric.test_type, meta.lowerIsBetter, window);
    for (const a of athletes) {
      const t = best.get(a.id); if (!t) continue;
      const v = bwCoefficient(Number(t.value), a.bodyweight); if (v == null) continue;
      rows.push({ athlete: a, value: v, breakdown: `${t.value} ${meta.unit} @ ${a.bodyweight} lb`, date: t.test_date });
    }
  } else if (metric.kind === "ratio" && metric.numerator_test && metric.denominator_test) {
    const nMeta = testTypeMeta(metric.numerator_test);
    const dMeta = testTypeMeta(metric.denominator_test);
    const nBest = bestByAthlete(tests, metric.numerator_test, nMeta.lowerIsBetter, window);
    const dBest = bestByAthlete(tests, metric.denominator_test, dMeta.lowerIsBetter, window);
    for (const a of athletes) {
      const n = nBest.get(a.id); const d = dBest.get(a.id);
      if (!n || !d || Number(d.value) === 0) continue;
      rows.push({
        athlete: a, value: Number(n.value) / Number(d.value),
        breakdown: `${n.value} / ${d.value}`,
        date: n.test_date > d.test_date ? n.test_date : d.test_date,
      });
    }
  } else if (metric.kind === "lift_max" && metric.exercise_name) {
    const measurement = (metric.measurement ?? "load") as "load" | "time" | "height" | "speed";
    const unit = measurement === "time" ? "s" : measurement === "height" ? "in" : measurement === "speed" ? "mph" : "lb";
    const best = bestLiftByAthlete(lifts, metric.exercise_name, window, measurement);
    for (const a of athletes) {
      const b = best.get(a.id); if (!b) continue;
      const reps = b.row.reps ?? 1;
      const showReps = measurement === "load" && reps > 1;
      rows.push({
        athlete: a, value: b.value,
        breakdown: showReps ? `${b.value} ${unit} × ${reps}` : `${b.value} ${unit}`,
        date: b.row.lift_date,
      });
    }

  } else if (metric.kind === "attendance_pct") {
    let w = window;
    if (!w.from && !w.to && metric.since_days) {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - metric.since_days);
      w = { from: cutoff.toISOString().slice(0, 10) };
    }
    const filtered = attendance.filter((r) => inWindow(r.session_date, w));
    const byAthlete = new Map<string, { total: number; present: number; latest: string }>();
    for (const r of filtered) {
      const cur = byAthlete.get(r.athlete_id) ?? { total: 0, present: 0, latest: r.session_date };
      cur.total += 1; if (r.present) cur.present += 1;
      if (r.session_date > cur.latest) cur.latest = r.session_date;
      byAthlete.set(r.athlete_id, cur);
    }
    for (const a of athletes) {
      const s = byAthlete.get(a.id); if (!s || s.total === 0) continue;
      rows.push({ athlete: a, value: (s.present / s.total) * 100, breakdown: `${s.present}/${s.total} sessions`, date: s.latest });
    }
  } else if (metric.kind === "improvement_pct" && metric.test_type) {
    const meta = testTypeMeta(metric.test_type);
    const pairs = firstAndLatest(tests, metric.test_type, window);
    for (const a of athletes) {
      const p = pairs.get(a.id); if (!p || p.first.id === p.latest.id) continue;
      const v = percentImprovement(Number(p.first.value), Number(p.latest.value), meta.lowerIsBetter);
      rows.push({
        athlete: a, value: v,
        breakdown: `${p.first.value} → ${p.latest.value} ${meta.unit}`,
        date: p.latest.test_date,
      });
    }
  } else if (metric.kind === "formula" && metric.formula) {
    for (const a of athletes) {
      const scope: Record<string, number> = {};
      let missing = false;
      const parts: string[] = [];
      for (const v of metric.variables ?? []) {
        const val = resolveVar(v, a, tests, lifts, window, testTypeMeta);
        if (val == null) { missing = true; break; }
        scope[v.name] = val;
        parts.push(`${v.name}=${val}`);
      }
      if (missing) continue;
      try {
        const raw = evaluate(metric.formula, scope);
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;
        rows.push({ athlete: a, value, breakdown: parts.join(" · "), date: today });
      } catch {
        continue;
      }
    }
  }

  rows.sort((a, b) => lower ? a.value - b.value : b.value - a.value);
  return rows;
}
