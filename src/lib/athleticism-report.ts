// Athleticism Report Builder — a coach-configurable, multi-quality athlete
// report (Size, Flexibility, Upper Body, Lower Body, Reactivity, Agility,
// Accel, Speed), each backed by 1-3 real test/metric results. Reuses the
// spider-graph normalization engine (src/lib/spider.ts) so "quality level"
// scoring stays consistent with the rest of the app's percentile math.
import type {
  Athlete,
  TestRow,
  LiftRow,
  CustomMetric,
  CustomTestType,
  SpiderMetric,
  SpiderTemplate,
  SpiderComparisonGroup,
  SpiderNormalizationMethod,
} from "@/lib/queries";
import { computeSpider, type SpiderRow } from "@/lib/spider";
import { TEST_TYPES } from "@/lib/domain";

export type QualityKey =
  | "size"
  | "flexibility"
  | "upper_body"
  | "lower_body"
  | "reactivity"
  | "agility"
  | "accel"
  | "speed";

export const QUALITIES: { key: QualityKey; label: string }[] = [
  { key: "size", label: "Size" },
  { key: "flexibility", label: "Flexibility" },
  { key: "upper_body", label: "Upper Body" },
  { key: "lower_body", label: "Lower Body" },
  { key: "reactivity", label: "Reactivity" },
  { key: "agility", label: "Agility" },
  { key: "accel", label: "Accel" },
  { key: "speed", label: "Speed" },
];
export const MAX_METRICS_PER_QUALITY = 3;
export const MAX_HIGHLIGHTS = 3;

export type ReportConfig = {
  qualityMetrics: Record<QualityKey, string[]>; // metric_key strings ("test:x" / "metric:id")
  starred: string[]; // metric_key list, capped at MAX_HIGHLIGHTS across the whole report
  comparisonGroup: SpiderComparisonGroup;
  normalizationMethod: SpiderNormalizationMethod;
  sections: { spider: boolean; gainBoard: boolean; physicalProfile: boolean };
};

export const DEFAULT_CONFIG: ReportConfig = {
  qualityMetrics: {
    size: [],
    flexibility: [],
    upper_body: ["test:bench_1rm"],
    lower_body: ["test:squat_1rm", "test:deadlift_1rm"],
    reactivity: ["test:vertical_jump"],
    agility: ["test:pro_agility"],
    accel: ["test:sprint_10y"],
    speed: ["test:sprint_40y"],
  },
  starred: [],
  comparisonGroup: "team",
  normalizationMethod: "percentile",
  sections: { spider: true, gainBoard: true, physicalProfile: true },
};

export const LEVEL_LABELS = ["Foundational", "Developing", "Solid", "Strong", "Elite"];

export function levelFromScore(score: number): number {
  if (score >= 80) return 4;
  if (score >= 60) return 3;
  if (score >= 40) return 2;
  if (score >= 20) return 1;
  return 0;
}

export type MetricOption = { key: string; label: string; unit: string; group: string };

/** Every test type (built-in + org custom) and custom metric, in the "test:"/"metric:" key scheme. */
export function metricOptions(
  customTypes: CustomTestType[],
  customMetrics: CustomMetric[],
): MetricOption[] {
  const fromBuiltin = TEST_TYPES.map((t) => ({
    key: `test:${t.value}`,
    label: t.label,
    unit: t.unit,
    group: t.group,
  }));
  const fromCustomTypes = customTypes.map((c) => ({
    key: `test:${c.value}`,
    label: c.label,
    unit: c.unit,
    group: c.group_name || "Custom tests",
  }));
  const fromMetrics = customMetrics.map((m) => ({
    key: `metric:${m.id}`,
    label: m.name,
    unit: m.unit ?? "",
    group: "Custom metrics",
  }));
  return [...fromBuiltin, ...fromCustomTypes, ...fromMetrics];
}

export function metricLabelFor(key: string, options: MetricOption[]): string {
  return options.find((o) => o.key === key)?.label ?? key.split(":")[1] ?? key;
}

export type QualityResult = {
  key: QualityKey;
  label: string;
  metrics: (SpiderRow & { starred: boolean })[];
  avgNormalized: number | null;
  level: number | null;
  levelLabel: string;
};

export type HighlightStat = {
  key: string;
  label: string;
  unit: string;
  raw: number | null;
  qualityLabel: string;
};

export type GainRow = {
  key: string;
  label: string;
  unit: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  improved: boolean | null;
};

export type AthleticismReport = {
  qualities: QualityResult[];
  overallLevel: number | null;
  overallLevelLabel: string;
  highlighted: HighlightStat[];
  gainBoard: GainRow[];
  autoNote: string;
};

export function computeAthleticismReport(input: {
  athlete: Athlete;
  athletes: Athlete[];
  tests: TestRow[];
  lifts: LiftRow[];
  customMetrics: CustomMetric[];
  customTypes: CustomTestType[];
  config: ReportConfig;
}): AthleticismReport {
  const { athlete, athletes, tests, lifts, customMetrics, customTypes, config } = input;
  const options = metricOptions(customTypes, customMetrics);

  const template: SpiderTemplate = {
    id: "adhoc-athleticism-report",
    organization_id: athlete.organization_id,
    name: "Athleticism Report",
    is_default: false,
    assignment: {},
    normalization_method: config.normalizationMethod,
    comparison_group: config.comparisonGroup,
    date_rule: "career",
    kpi_config: {},
    options: {},
    created_at: "",
    updated_at: "",
  };

  let seq = 0;
  const qualities: QualityResult[] = QUALITIES.map((q) => {
    const keys = config.qualityMetrics[q.key] ?? [];
    const spiderMetrics: SpiderMetric[] = keys.map((k) => ({
      id: `q-${q.key}-${seq++}`,
      template_id: template.id,
      position: seq,
      metric_key: k,
      display_label: metricLabelFor(k, options),
      hide_if_missing: false,
    }));
    const rows = computeSpider({
      template,
      metrics: spiderMetrics,
      athlete,
      athletes,
      tests,
      lifts,
      customMetrics,
      customTypes,
    });
    const withStar = rows.map((r) => ({ ...r, starred: config.starred.includes(r.key) }));
    const present = withStar.filter((r) => !r.missing && r.normalized != null);
    const avg = present.length
      ? present.reduce((a, r) => a + (r.normalized ?? 0), 0) / present.length
      : null;
    return {
      key: q.key,
      label: q.label,
      metrics: withStar,
      avgNormalized: avg,
      level: avg == null ? null : levelFromScore(avg),
      levelLabel: avg == null ? "No data" : LEVEL_LABELS[levelFromScore(avg)],
    };
  });

  const qualityAvgs = qualities.map((q) => q.avgNormalized).filter((v): v is number => v != null);
  const overallScore = qualityAvgs.length
    ? qualityAvgs.reduce((a, b) => a + b, 0) / qualityAvgs.length
    : null;
  const overallLevel = overallScore == null ? null : levelFromScore(overallScore);

  const highlighted: HighlightStat[] = [];
  for (const q of qualities) {
    for (const m of q.metrics) {
      if (m.starred && highlighted.length < MAX_HIGHLIGHTS) {
        highlighted.push({
          key: m.key,
          label: m.label,
          unit: m.unit,
          raw: m.raw,
          qualityLabel: q.label,
        });
      }
    }
  }

  // Gain board: earliest vs. most recent value per unique "test:" metric in the report.
  const seenTestKeys = new Set<string>();
  const gainBoard: GainRow[] = [];
  for (const q of qualities) {
    for (const m of q.metrics) {
      if (!m.key.startsWith("test:") || seenTestKeys.has(m.key)) continue;
      seenTestKeys.add(m.key);
      const testType = m.key.slice("test:".length);
      const rows = tests
        .filter((t) => t.athlete_id === athlete.id && t.test_type === testType)
        .slice()
        .sort((a, b) => a.test_date.localeCompare(b.test_date));
      if (rows.length < 2) continue;
      const before = Number(rows[0].value);
      const after = Number(rows[rows.length - 1].value);
      const delta = after - before;
      const improved = m.lowerIsBetter ? delta < 0 : delta > 0;
      gainBoard.push({ key: m.key, label: m.label, unit: m.unit, before, after, delta, improved });
    }
  }

  const strongest = qualities
    .filter((q) => q.avgNormalized != null)
    .sort((a, b) => (b.avgNormalized ?? 0) - (a.avgNormalized ?? 0))[0];
  const weakest = qualities
    .filter((q) => q.avgNormalized != null)
    .sort((a, b) => (a.avgNormalized ?? 0) - (b.avgNormalized ?? 0))[0];
  const noteParts: string[] = [];
  if (overallLevel != null) {
    noteParts.push(
      `${athlete.name}'s overall athleticism level is ${LEVEL_LABELS[overallLevel]} (${overallLevel}/4).`,
    );
  }
  if (strongest && strongest.key !== weakest?.key) {
    noteParts.push(`${strongest.label} stands out as a strength (${strongest.levelLabel}).`);
  }
  if (weakest && weakest.avgNormalized != null && weakest.avgNormalized < 60) {
    noteParts.push(`${weakest.label} is the best next area to build (${weakest.levelLabel}).`);
  }
  const improved = gainBoard.filter((g) => g.improved);
  if (improved.length) {
    noteParts.push(
      `Since first testing, ${improved.map((g) => g.label).join(", ")} ${improved.length === 1 ? "has" : "have"} improved.`,
    );
  }
  const autoNote = noteParts.length
    ? noteParts.join(" ")
    : `${athlete.name} doesn't have enough test data yet to generate a summary — log a few tests to unlock scoring.`;

  return {
    qualities,
    overallLevel,
    overallLevelLabel: overallLevel == null ? "No data" : LEVEL_LABELS[overallLevel],
    highlighted,
    gainBoard,
    autoNote,
  };
}

// Reference for a UI empty-state hint: which built-in test types have no
// obvious quality mapping (so the picker can nudge coaches to configure them).
export const UNMAPPED_QUALITY_HINT: Record<QualityKey, string> = {
  size: "Pick a bodyweight/size metric from Metrics, or a custom test type.",
  flexibility: "Add a custom test type (Tests → Manage types) to score flexibility.",
  upper_body: "",
  lower_body: "",
  reactivity: "",
  agility: "",
  accel: "",
  speed: "",
};
