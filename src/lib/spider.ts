// Spider graph normalization engine.
//
// Given a template, its metrics, and the org's athletes + test/lift data,
// produce a normalized 0..100 score per metric for a target athlete —
// plus the comparison-group baseline so we can render an overlay.
//
// Missing metrics are marked `missing: true` (never zero) so the UI can
// render a broken spoke instead of pretending the athlete scored 0.

import type {
  Athlete,
  TestRow,
  LiftRow,
  CustomMetric,
  CustomTestType,
  Exercise,
  SpiderTemplate,
  SpiderMetric,
  SpiderComparisonGroup,
  SpiderDateRule,
} from "@/lib/queries";
import { testTypeMeta as baseTestTypeMeta } from "@/lib/domain";
import { computeMetric } from "@/lib/metrics";

export type SpiderRow = {
  key: string;
  label: string;
  unit: string;
  raw: number | null;
  normalized: number | null;
  groupMedian: number | null; // baseline (median of comparison group) 0..100
  missing: boolean;
  lowerIsBetter: boolean;
};

function metaFor(testType: string, customTypes: CustomTestType[]) {
  const c = customTypes.find((x) => x.value === testType);
  if (c) return { label: c.label, unit: c.unit, lowerIsBetter: c.lower_is_better };
  return baseTestTypeMeta(testType);
}

function dateCutoff(rule: SpiderDateRule): string | null {
  if (rule === "career") return null;
  if (rule === "latest") return null;
  if (rule === "season") return `${new Date().getUTCFullYear()}-01-01`;
  if (rule === "last_90d") {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function bestTestPerAthlete(
  tests: TestRow[],
  testType: string,
  lowerIsBetter: boolean,
  cutoff: string | null,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tests) {
    if (t.test_type !== testType) continue;
    if (cutoff && t.test_date < cutoff) continue;
    const v = Number(t.value);
    const cur = m.get(t.athlete_id);
    if (cur == null || (lowerIsBetter ? v < cur : v > cur)) m.set(t.athlete_id, v);
  }
  return m;
}

// Logged workout exercises as a metric source ("lift:<exercise name>"), so a
// spider template can score real lift/rep/time results the same way it
// scores formal tests — no need to pre-create a custom metric per exercise.
function exerciseLowerIsBetter(measurement: Exercise["measurement_type"] | undefined): boolean {
  return measurement === "seconds";
}
function exerciseUnit(measurement: Exercise["measurement_type"] | undefined): string {
  switch (measurement) {
    case "seconds":
      return "s";
    case "inches":
      return "in";
    case "mph":
      return "mph";
    case "reps":
      return "reps";
    default:
      return "lb";
  }
}
function exerciseValue(
  l: LiftRow,
  measurement: Exercise["measurement_type"] | undefined,
): number | null {
  const raw =
    measurement === "seconds"
      ? l.time_seconds
      : measurement === "inches"
        ? l.distance_in
        : measurement === "reps"
          ? l.reps
          : l.load; // "load" and "mph" (speed) both log through the load field.
  return raw == null ? null : Number(raw);
}
function bestLiftPerAthlete(
  lifts: LiftRow[],
  exerciseName: string,
  measurement: Exercise["measurement_type"] | undefined,
  lowerIsBetter: boolean,
  cutoff: string | null,
): Map<string, number> {
  const target = exerciseName.trim().toLowerCase();
  const m = new Map<string, number>();
  for (const l of lifts) {
    if ((l.exercise ?? "").trim().toLowerCase() !== target) continue;
    if (cutoff && l.lift_date < cutoff) continue;
    const v = exerciseValue(l, measurement);
    if (v == null) continue;
    const cur = m.get(l.athlete_id);
    if (cur == null || (lowerIsBetter ? v < cur : v > cur)) m.set(l.athlete_id, v);
  }
  return m;
}

function percentileOf(val: number, pool: number[], lowerIsBetter: boolean): number {
  if (!pool.length) return 0;
  const better = lowerIsBetter
    ? pool.filter((v) => v > val).length
    : pool.filter((v) => v < val).length;
  return Math.round((better / pool.length) * 100);
}

function medianPercentile(pool: number[], lowerIsBetter: boolean): number {
  if (!pool.length) return 50;
  const sorted = pool.slice().sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  return percentileOf(mid, sorted, lowerIsBetter);
}

function comparisonPool(
  athletes: Athlete[],
  athlete: Athlete,
  group: SpiderComparisonGroup,
): Athlete[] {
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  switch (group) {
    case "team":
      return athlete.team_id ? athletes.filter((a) => a.team_id === athlete.team_id) : athletes;
    case "sport":
      return athlete.sport
        ? athletes.filter((a) => norm(a.sport) === norm(athlete.sport))
        : athletes;
    case "grade":
      return athlete.grade != null ? athletes.filter((a) => a.grade === athlete.grade) : athletes;
    case "position":
      return athlete.position
        ? athletes.filter(
            (a) =>
              norm(a.position) === norm(athlete.position) && norm(a.sport) === norm(athlete.sport),
          )
        : athletes;
    case "org":
    case "custom":
    default:
      return athletes;
  }
}

export type SpiderInput = {
  template: SpiderTemplate;
  metrics: SpiderMetric[];
  athlete: Athlete;
  athletes: Athlete[];
  tests: TestRow[];
  lifts: LiftRow[];
  customMetrics: CustomMetric[];
  customTypes: CustomTestType[];
  exercises?: Exercise[];
};

export function computeSpider(input: SpiderInput): SpiderRow[] {
  const {
    template,
    metrics,
    athlete,
    athletes,
    tests,
    lifts,
    customMetrics,
    customTypes,
    exercises = [],
  } = input;
  const cutoff = dateCutoff(template.date_rule);
  const pool = comparisonPool(athletes, athlete, template.comparison_group);
  const poolIds = new Set(pool.map((a) => a.id));

  const rows: SpiderRow[] = [];

  for (const m of metrics.slice().sort((a, b) => a.position - b.position)) {
    const [kind, key] = m.metric_key.split(":") as [string, string];
    let label = m.display_label ?? m.metric_key;
    let unit = "";
    let lowerIsBetter = false;
    let mine: number | null = null;
    let poolValues: number[] = [];

    if (kind === "test") {
      const meta = metaFor(key, customTypes);
      label = m.display_label ?? meta.label;
      unit = meta.unit;
      lowerIsBetter = meta.lowerIsBetter;
      const bests = bestTestPerAthlete(tests, key, lowerIsBetter, cutoff);
      mine = bests.get(athlete.id) ?? null;
      for (const [id, v] of bests) if (poolIds.has(id)) poolValues.push(v);
    } else if (kind === "metric") {
      const cm = customMetrics.find((c) => c.id === key);
      if (!cm) {
        rows.push({
          key: m.metric_key,
          label,
          unit: "",
          raw: null,
          normalized: null,
          groupMedian: null,
          missing: true,
          lowerIsBetter: false,
        });
        continue;
      }
      label = m.display_label ?? cm.name;
      unit = cm.unit ?? "";
      lowerIsBetter = cm.lower_is_better;
      const results = computeMetric(
        cm,
        pool,
        tests,
        lifts,
        [],
        { from: cutoff ?? null, to: null },
        customTypes,
      );
      mine = results.find((r) => r.athlete.id === athlete.id)?.value ?? null;
      poolValues = results
        .map((r) => r.value)
        .filter((v): v is number => v != null && Number.isFinite(v));
    } else if (kind === "lift") {
      const ex = exercises.find((e) => e.name.trim().toLowerCase() === key.trim().toLowerCase());
      label = m.display_label ?? ex?.name ?? key;
      unit = exerciseUnit(ex?.measurement_type);
      lowerIsBetter = exerciseLowerIsBetter(ex?.measurement_type);
      const bests = bestLiftPerAthlete(lifts, key, ex?.measurement_type, lowerIsBetter, cutoff);
      mine = bests.get(athlete.id) ?? null;
      for (const [id, v] of bests) if (poolIds.has(id)) poolValues.push(v);
    } else {
      rows.push({
        key: m.metric_key,
        label,
        unit: "",
        raw: null,
        normalized: null,
        groupMedian: null,
        missing: true,
        lowerIsBetter: false,
      });
      continue;
    }

    if (mine == null) {
      rows.push({
        key: m.metric_key,
        label,
        unit,
        raw: null,
        normalized: null,
        groupMedian: null,
        missing: true,
        lowerIsBetter,
      });
      continue;
    }

    let normalized: number;
    switch (template.normalization_method) {
      case "pb_percent": {
        // Athlete's PB across all-time = mine (already best-per-athlete with current cutoff).
        // Compare against athlete's career best.
        const ex =
          kind === "lift"
            ? exercises.find((e) => e.name.trim().toLowerCase() === key.trim().toLowerCase())
            : undefined;
        const careerBests =
          kind === "test"
            ? bestTestPerAthlete(tests, key, lowerIsBetter, null)
            : kind === "lift"
              ? bestLiftPerAthlete(lifts, key, ex?.measurement_type, lowerIsBetter, null)
              : new Map<string, number>();
        const pb = careerBests.get(athlete.id) ?? mine;
        normalized = lowerIsBetter
          ? Math.round(Math.min(100, (pb / mine) * 100))
          : Math.round(Math.min(100, (mine / pb) * 100));
        break;
      }
      case "goal": {
        // Coach-set goal not stored yet; fallback to pool-relative percentile.
        normalized = percentileOf(mine, poolValues, lowerIsBetter);
        break;
      }
      case "threshold": {
        // Simple threshold: pool max = 100.
        const best = lowerIsBetter ? Math.min(...poolValues) : Math.max(...poolValues);
        normalized =
          best === 0
            ? 0
            : Math.round(Math.min(100, lowerIsBetter ? (best / mine) * 100 : (mine / best) * 100));
        break;
      }
      case "percentile":
      default:
        normalized = percentileOf(mine, poolValues, lowerIsBetter);
    }

    rows.push({
      key: m.metric_key,
      label,
      unit,
      raw: mine,
      normalized,
      groupMedian: medianPercentile(poolValues, lowerIsBetter),
      missing: false,
      lowerIsBetter,
    });
  }

  return rows;
}

// Pick the best-matching template for the athlete.
// Priority: sport+team+position specifics > default > first.
export function pickTemplate(templates: SpiderTemplate[], athlete: Athlete): SpiderTemplate | null {
  if (!templates.length) return null;
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  const scored = templates.map((t) => {
    let score = 0;
    const a = t.assignment ?? {};
    if (a.team_id && a.team_id === athlete.team_id) score += 8;
    if (a.sport && norm(a.sport) === norm(athlete.sport)) score += 4;
    if (a.position && norm(a.position) === norm(athlete.position)) score += 2;
    if (t.is_default) score += 1;
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].t;
}
