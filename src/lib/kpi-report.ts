// KPI Report Card Builder — pure, client-side parsing + scoring.
// Coaches upload a testing spreadsheet (xlsx/xls/csv); nothing is stored or uploaded.

import * as XLSX from "xlsx";
import { buildReportPdf, type PdfSection } from "./report-export";

export type KpiCategory = "strength" | "power" | "speed" | "cod" | "body";

export const CATEGORY_LABEL: Record<KpiCategory, string> = {
  strength: "Strength",
  power: "Power",
  speed: "Speed",
  cod: "Change of Direction",
  body: "Body",
};

export const SCORED_CATEGORIES: KpiCategory[] = ["strength", "power", "speed", "cod"];

export type KpiColumn = {
  key: string;
  label: string;
  category: KpiCategory;
  /** Lower values are better (timed tests). */
  lowerBetter: boolean;
};

export type KpiRecord = {
  name: string;
  date: string | null;
  values: Record<string, number | null>;
};

export type KpiParse = {
  columns: KpiColumn[];
  records: KpiRecord[];
  skipped: number;
  sheet: string | null;
};

// ---------- header classification ----------
const NAME_HEADERS = ["athlete", "athlete name", "name", "player", "player name", "full name", "last, first"];
const DATE_HEADERS = ["date", "test date", "session date", "day", "current date", "recorded"];

const RE = {
  height: /\bheight\b|\bht\b/i,
  weight: /\bweight\b|\bbody\s*weight\b|\bbw\b|\bmass\b(?!.*velo)/i,
  strength: /squat|bench|deadlift|dead\s*lift|press|pull[- ]?up|chin|row|trap\s*bar|hex\s*bar|rack\s*pull|iso|isometric|rel\.?$/i,
  power: /clean|snatch|jerk|vertical|vert\b|jump|broad|med\s*ball|throw|power|rsi|imtp|peak\s*force|watt/i,
  speed: /\b\d{1,2}\s*(yd|yard|m|meter)?\s*(dash|sprint|fly|split)|fly\b|dash|sprint|mph|velo|top\s*speed|max\s*speed|into\b|\b10\b|\b20\b|\b40\b|\b60\b/i,
  cod: /5.?10.?5|pro\s*agility|shuttle|agility|180|l[- ]?drill|t[- ]?test|comeback|roll|change\s*of\s*direction|\bcod\b/i,
  timed: /dash|shuttle|agility|5.?10.?5|180|roll|comeback|l[- ]?drill|t[- ]?test|\btime\b|\bsec\b|\(s\)|into\b|fly\b|split/i,
  velocity: /mph|velo|m\/s|top\s*speed|max\s*speed/i,
};

export function classify(label: string): { category: KpiCategory; lowerBetter: boolean } {
  const l = label.trim();
  if (RE.height.test(l) || RE.weight.test(l)) return { category: "body", lowerBetter: false };
  let category: KpiCategory = "strength";
  if (RE.cod.test(l)) category = "cod";
  else if (RE.speed.test(l) && !RE.strength.test(l)) category = "speed";
  else if (RE.power.test(l)) category = "power";
  else if (RE.strength.test(l)) category = "strength";
  else category = "strength";
  const lowerBetter = RE.timed.test(l) && !RE.velocity.test(l);
  return { category, lowerBetter };
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  // Support 6'2" style heights
  const ft = s.match(/^(\d)\s*[’'`]\s*(\d{1,2})?\s*["”]?$/);
  if (ft) return Number(ft[1]) * 12 + Number(ft[2] ?? 0);
  const n = Number(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toDateString(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    const yr = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${yr}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Reads any wide testing sheet: one row per athlete (per test date), one column per KPI. */
export function parseKpiWorkbook(data: ArrayBuffer): KpiParse {
  const wb = XLSX.read(data, { type: "array", raw: true });
  let best: KpiParse = { columns: [], records: [], skipped: 0, sheet: null };
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false, raw: true });
    const res = parseGrid(grid, name);
    if (res.records.length > best.records.length) best = res;
  }
  return best;
}

function parseGrid(grid: unknown[][], sheet: string): KpiParse {
  let headerIdx = -1;
  let nameCol = -1;
  for (let i = 0; i < Math.min(grid.length, 40); i++) {
    const row = grid[i] ?? [];
    const idx = row.findIndex((c) => NAME_HEADERS.includes(String(c ?? "").trim().toLowerCase()));
    const filled = row.filter((c) => String(c ?? "").trim() !== "").length;
    if (idx !== -1 && filled >= 2) {
      headerIdx = i;
      nameCol = idx;
      break;
    }
  }
  if (headerIdx === -1) return { columns: [], records: [], skipped: 0, sheet: null };

  const header = grid[headerIdx] ?? [];
  let dateCol = -1;
  const columns: KpiColumn[] = [];
  const colIndex: number[] = [];
  const seen = new Set<string>();

  header.forEach((cell, c) => {
    const label = String(cell ?? "").trim();
    if (!label || c === nameCol) return;
    const lower = label.toLowerCase();
    if (dateCol === -1 && DATE_HEADERS.includes(lower)) {
      dateCol = c;
      return;
    }
    const { category, lowerBetter } = classify(label);
    let key = lower.replace(/\W+/g, "_");
    while (seen.has(key)) key += "_2";
    seen.add(key);
    columns.push({ key, label, category, lowerBetter });
    colIndex.push(c);
  });

  const records: KpiRecord[] = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i] ?? [];
    const name = String(raw[nameCol] ?? "").trim();
    if (!name || NAME_HEADERS.includes(name.toLowerCase())) continue;
    const values: Record<string, number | null> = {};
    let any = false;
    columns.forEach((col, k) => {
      const v = num(raw[colIndex[k]]);
      values[col.key] = v;
      if (v != null) any = true;
    });
    if (!any) {
      skipped++;
      continue;
    }
    records.push({ name, date: dateCol === -1 ? null : toDateString(raw[dateCol]), values });
  }

  // Drop columns that were entirely empty.
  const used = columns.filter((c) => records.some((r) => r.values[c.key] != null));
  return { columns: used, records, skipped, sheet };
}

// ---------- scoring ----------
export type MetricStat = {
  column: KpiColumn;
  value: number | null;
  previous: number | null;
  delta: number | null; // signed change in raw units
  improved: boolean | null;
  percentile: number | null; // 0-100, direction aware
  teamAvg: number | null;
  teamBest: number | null;
  /** Self-referenced index (0-100) for this KPI: PR / trend / consistency / compliance. */
  self: SelfScore | null;
};

/** Weighted self-comparison index — how the athlete stacks up against their own history. */
export type SelfScore = {
  score: number; // 0-100
  pr: number | null;
  trend: number | null;
  consistency: number | null;
  compliance: number | null;
  personalBest: number | null;
};

export const SELF_WEIGHTS = { pr: 0.4, trend: 0.3, consistency: 0.2, compliance: 0.1 };

export type AthleteKpi = {
  name: string;
  dates: string[];
  latestDate: string | null;
  metrics: MetricStat[];
  categoryScores: Partial<Record<KpiCategory, number>>; // 0-100
  overall: number | null; // 0-100
  grade: Grade;
  height: number | null;
  weight: number | null;
  ppi: number | null;
  quadrant: Quadrant | null;
  /** Average of per-KPI self scores — Athlete Momentum Score. */
  momentum: number | null;
  momentumParts: { pr: number | null; trend: number | null; consistency: number | null; compliance: number | null };
};


export type Quadrant = "hs-hstr" | "hs-lstr" | "ls-hstr" | "ls-lstr";

export const QUADRANT_LABEL: Record<Quadrant, string> = {
  "hs-hstr": "High Speed · High Strength",
  "hs-lstr": "High Speed · Lower Strength",
  "ls-hstr": "Low Speed · High Strength",
  "ls-lstr": "Low Speed · Low Strength",
};

export type Grade = { key: "diamond" | "platinum" | "gold" | "silver" | "bronze"; label: string };

export function gradeFor(score: number | null): Grade {
  if (score == null) return { key: "bronze", label: "—" };
  if (score >= 90) return { key: "diamond", label: "Diamond" };
  if (score >= 75) return { key: "platinum", label: "Platinum" };
  if (score >= 55) return { key: "gold", label: "Gold" };
  if (score >= 35) return { key: "silver", label: "Silver" };
  return { key: "bronze", label: "Bronze" };
}

function percentile(values: number[], v: number, lowerBetter: boolean) {
  if (values.length < 2) return null;
  const beaten = values.filter((x) => (lowerBetter ? x > v : x < v)).length;
  const equal = values.filter((x) => x === v).length;
  return ((beaten + equal / 2) / values.length) * 100;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/** Direction-aware performance ratio vs a reference (1 = matches reference). */
function ratio(value: number, reference: number, lowerBetter: boolean) {
  if (!Number.isFinite(value) || !Number.isFinite(reference) || value === 0 || reference === 0) return null;
  return lowerBetter ? reference / value : value / reference;
}

/** Trend score from a % improvement: +5% -> 100, 0% -> 80, -2% -> 70, -5% -> 50. */
export function trendScore(improvement: number): number {
  if (improvement >= 0.05) return 100;
  if (improvement >= 0) return clamp(80 + (improvement / 0.05) * 20);
  if (improvement >= -0.02) return clamp(80 + (improvement / 0.02) * 10);
  if (improvement >= -0.05) return clamp(70 + ((improvement + 0.02) / 0.03) * 20);
  return clamp(50 + ((improvement + 0.05) / 0.05) * 50);
}

/**
 * Weighted self index for one KPI history (chronological, direction aware):
 * 40% PR · 30% trend (last 5 vs prior 5) · 20% consistency · 10% compliance.
 * Missing components are dropped and the remaining weights re-normalised.
 */
export function selfScoreFor(
  history: number[],
  lowerBetter: boolean,
  compliance: number | null,
): SelfScore | null {
  if (!history.length) return null;
  const best = lowerBetter ? Math.min(...history) : Math.max(...history);
  const current = history[history.length - 1];

  const prRatio = ratio(current, best, lowerBetter);
  const pr = prRatio == null ? null : clamp(prRatio * 100);

  let trend: number | null = null;
  if (history.length >= 4) {
    const recent = history.slice(-5);
    const prior = history.slice(-10, -5).length ? history.slice(-10, -5) : history.slice(0, -5);
    const a = mean(recent);
    const b = mean(prior.length ? prior : history.slice(0, Math.max(1, history.length - recent.length)));
    if (a != null && b != null && b !== 0) {
      const improvement = lowerBetter ? (b - a) / b : (a - b) / b;
      trend = trendScore(improvement);
    }
  }

  let consistency: number | null = null;
  if (history.length >= 3) {
    const recent = history.slice(-5);
    const near = recent.filter((v) => {
      const r = ratio(v, best, lowerBetter);
      return r != null && r >= 0.95;
    }).length;
    consistency = clamp((near / recent.length) * 100);
  }

  const parts: Array<[number | null, number]> = [
    [pr, SELF_WEIGHTS.pr],
    [trend, SELF_WEIGHTS.trend],
    [consistency, SELF_WEIGHTS.consistency],
    [compliance == null ? null : clamp(compliance), SELF_WEIGHTS.compliance],
  ];
  const used = parts.filter(([v]) => v != null) as Array<[number, number]>;
  const wsum = used.reduce((s, [, w]) => s + w, 0);
  if (!wsum) return null;
  const score = used.reduce((s, [v, w]) => s + v * w, 0) / wsum;

  return { score, pr, trend, consistency, compliance: compliance == null ? null : clamp(compliance), personalBest: best };
}


export function buildAthletes(parse: KpiParse): AthleteKpi[] {
  const { columns, records } = parse;
  const byName = new Map<string, KpiRecord[]>();
  for (const r of records) {
    const list = byName.get(r.name);
    if (list) list.push(r);
    else byName.set(r.name, [r]);
  }
  for (const list of byName.values()) {
    list.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  }

  // Latest value per athlete per column, used for team percentiles.
  const latestValue = new Map<string, Record<string, number | null>>();
  for (const [name, list] of byName) {
    const out: Record<string, number | null> = {};
    for (const c of columns) {
      const v = [...list].reverse().find((r) => r.values[c.key] != null)?.values[c.key] ?? null;
      out[c.key] = v;
    }
    latestValue.set(name, out);
  }

  const pool: Record<string, number[]> = {};
  for (const c of columns) {
    pool[c.key] = Array.from(latestValue.values())
      .map((v) => v[c.key])
      .filter((v): v is number => v != null);
  }

  const heightCol = columns.find((c) => c.category === "body" && RE.height.test(c.label));
  const weightCol = columns.find((c) => c.category === "body" && RE.weight.test(c.label));

  const maxSessions = Math.max(1, ...Array.from(byName.values(), (l) => l.length));

  const athletes: AthleteKpi[] = [];
  for (const [name, list] of byName) {
    const latest = latestValue.get(name)!;
    const metrics: MetricStat[] = columns.map((c) => {
      const value = latest[c.key];
      const history = list.map((r) => r.values[c.key]).filter((v): v is number => v != null);
      const previous = history.length > 1 ? history[history.length - 2] : null;
      const delta = value != null && previous != null ? value - previous : null;
      const improved = delta == null ? null : c.lowerBetter ? delta < 0 : delta > 0;
      const vals = pool[c.key];
      const compliance = maxSessions > 1 ? (history.length / maxSessions) * 100 : null;
      return {
        column: c,
        value,
        previous,
        delta,
        improved,
        percentile: value == null ? null : percentile(vals, value, c.lowerBetter),
        teamAvg: mean(vals),
        teamBest: vals.length ? (c.lowerBetter ? Math.min(...vals) : Math.max(...vals)) : null,
        self: c.category === "body" ? null : selfScoreFor(history, c.lowerBetter, compliance),
      };
    });


    const categoryScores: Partial<Record<KpiCategory, number>> = {};
    for (const cat of SCORED_CATEGORIES) {
      const pcts = metrics
        .filter((m) => m.column.category === cat && m.percentile != null)
        .map((m) => m.percentile as number);
      const avg = mean(pcts);
      if (avg != null) categoryScores[cat] = avg;
    }
    const overall = mean(Object.values(categoryScores) as number[]);

    const height = heightCol ? latest[heightCol.key] : null;
    const weight = weightCol ? latest[weightCol.key] : null;

    const speedScore = categoryScores.speed ?? categoryScores.cod ?? null;
    const strengthScore = categoryScores.strength ?? categoryScores.power ?? null;
    const quadrant: Quadrant | null =
      speedScore == null || strengthScore == null
        ? null
        : speedScore >= 50
          ? strengthScore >= 50
            ? "hs-hstr"
            : "hs-lstr"
          : strengthScore >= 50
            ? "ls-hstr"
            : "ls-lstr";

    const selves = metrics.map((m) => m.self).filter((s): s is SelfScore => s != null);
    const pick = (k: "pr" | "trend" | "consistency" | "compliance") =>
      mean(selves.map((s) => s[k]).filter((v): v is number => v != null));

    athletes.push({
      name,
      dates: list.map((r) => r.date).filter((d): d is string => !!d),
      latestDate: [...list].reverse().find((r) => r.date)?.date ?? null,
      metrics,
      categoryScores,
      overall,
      grade: gradeFor(overall),
      height,
      weight,
      ppi: height && weight ? weight / height : null,
      quadrant,
      momentum: mean(selves.map((s) => s.score)),
      momentumParts: {
        pr: pick("pr"),
        trend: pick("trend"),
        consistency: pick("consistency"),
        compliance: pick("compliance"),
      },
    });

  }

  return athletes.sort((a, b) => a.name.localeCompare(b.name));
}

export const fmtVal = (v: number | null | undefined, d = 2) =>
  v == null ? "—" : Number(v).toFixed(Math.abs(Number(v)) >= 100 ? 0 : d);

// ---------- exports ----------
export function kpiCsv(athletes: AthleteKpi[], columns: KpiColumn[]): string {
  const head = [
    "Athlete",
    "Latest date",
    "Overall score",
    "Self score",
    "Grade",
    "Quadrant",
    ...SCORED_CATEGORIES.map((c) => `${CATEGORY_LABEL[c]} score`),
    ...columns.flatMap((c) => [c.label, `${c.label} change`]),
  ];
  const lines = [head.join(",")];
  for (const a of athletes) {
    const cells = [
      `"${a.name.replace(/"/g, '""')}"`,
      a.latestDate ?? "",
      a.overall == null ? "" : a.overall.toFixed(0),
      a.momentum == null ? "" : a.momentum.toFixed(0),
      a.grade.label,
      a.quadrant ? QUADRANT_LABEL[a.quadrant] : "",
      ...SCORED_CATEGORIES.map((c) => (a.categoryScores[c] == null ? "" : (a.categoryScores[c] as number).toFixed(0))),
      ...columns.flatMap((c) => {
        const m = a.metrics.find((x) => x.column.key === c.key);
        return [m?.value == null ? "" : String(m.value), m?.delta == null ? "" : m.delta.toFixed(2)];
      }),
    ];
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

export function exportKpiPdf(
  athletes: AthleteKpi[],
  columns: KpiColumn[],
  opts: { title?: string; subtitle?: string; filename?: string } = {},
) {
  const sections: PdfSection[] = [
    { kind: "heading", text: "Team summary", level: 1 },
    {
      kind: "table",
      head: ["Athlete", "Overall", "Self", "Grade", ...SCORED_CATEGORIES.map((c) => CATEGORY_LABEL[c]), "Quadrant"],
      body: [...athletes]
        .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1))
        .map((a) => [
          a.name,
          a.overall == null ? "—" : a.overall.toFixed(0),
          a.momentum == null ? "—" : a.momentum.toFixed(0),
          a.grade.label,
          ...SCORED_CATEGORIES.map((c) => (a.categoryScores[c] == null ? "—" : (a.categoryScores[c] as number).toFixed(0))),
          a.quadrant ? QUADRANT_LABEL[a.quadrant] : "—",
        ]),
    },
    { kind: "heading", text: "Athlete report cards", level: 1 },
  ];

  for (const a of athletes) {
    sections.push({ kind: "heading", text: a.name, level: 2 });
    sections.push({
      kind: "kv",
      rows: [
        ["Latest test", a.latestDate ?? "—"],
        ["Overall score", a.overall == null ? "—" : `${a.overall.toFixed(0)} / 100 · ${a.grade.label}`],
        ["Self score", a.momentum == null ? "—" : `${a.momentum.toFixed(0)} / 100`],
        ["Quadrant", a.quadrant ? QUADRANT_LABEL[a.quadrant] : "—"],
        ["Pounds per inch", a.ppi == null ? "—" : a.ppi.toFixed(2)],
      ],
    });
    sections.push({
      kind: "table",
      head: ["KPI", "Category", "Latest", "Previous", "Change", "Team avg", "Rank %", "Self"],
      body: a.metrics
        .filter((m) => m.value != null)
        .map((m) => [
          m.column.label,
          CATEGORY_LABEL[m.column.category],
          fmtVal(m.value),
          fmtVal(m.previous),
          m.delta == null ? "—" : `${m.delta > 0 ? "+" : ""}${m.delta.toFixed(2)}`,
          fmtVal(m.teamAvg),
          m.percentile == null ? "—" : m.percentile.toFixed(0),
          m.self == null ? "—" : m.self.score.toFixed(0),
        ]),
    });
  }
  void columns;

  buildReportPdf({
    title: opts.title ?? "KPI Performance Report",
    subtitle: opts.subtitle ?? `${athletes.length} athletes`,
    sections,
    filename: opts.filename ?? "kpi-report.pdf",
  });
}

// ---------- metric snapshot (team distribution per test date) ----------
export type MetricSnapshot = {
  column: KpiColumn;
  dates: string[];
  avg: (number | null)[];
  max: (number | null)[];
  min: (number | null)[];
  total: number[];
  bands: { threshold: number; counts: number[] }[];
};

/** Round to a readable step based on the spread of the data. */
function niceStep(span: number): number {
  if (span <= 0) return 1;
  const raw = span / 8;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

/** Team average / max / min plus a "how many athletes reached X" distribution, per test date. */
export function metricSnapshot(parse: KpiParse, key: string): MetricSnapshot | null {
  const column = parse.columns.find((c) => c.key === key);
  if (!column) return null;

  const groups = new Map<string, Map<string, number>>(); // date -> athlete -> value
  for (const r of parse.records) {
    const v = r.values[key];
    if (v == null) continue;
    const d = r.date ?? "All results";
    let g = groups.get(d);
    if (!g) groups.set(d, (g = new Map()));
    g.set(r.name, v);
  }
  if (!groups.size) return null;

  const dates = Array.from(groups.keys()).sort().slice(-4);
  const cols = dates.map((d) => Array.from(groups.get(d)!.values()));
  const all = cols.flat();
  if (!all.length) return null;

  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const step = niceStep(hi - lo);
  const thresholds: number[] = [];
  for (let t = Math.ceil(hi / step) * step; t >= lo - step / 2 && thresholds.length < 9; t -= step) {
    thresholds.push(Number(t.toFixed(4)));
  }
  if (column.lowerBetter) thresholds.reverse();

  return {
    column,
    dates,
    avg: cols.map((v) => mean(v)),
    max: cols.map((v) => (v.length ? Math.max(...v) : null)),
    min: cols.map((v) => (v.length ? Math.min(...v) : null)),
    total: cols.map((v) => v.length),
    bands: thresholds.map((threshold) => ({
      threshold,
      counts: cols.map((v) => v.filter((x) => (column.lowerBetter ? x <= threshold : x >= threshold)).length),
    })),
  };
}
