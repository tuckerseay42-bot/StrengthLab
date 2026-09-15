import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowDown, ArrowRight, ArrowUp, Trophy, Zap, Dumbbell, Activity, Award, Flame, Settings2, ChevronUp, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import type { Athlete, TestRow, LiftRow, AttendanceRow, RepMax, CustomTestType, CustomMetric } from "@/lib/queries";
import { customMetricsQO, spiderTemplatesQO } from "@/lib/queries";
import { computeMetric } from "@/lib/metrics";
import { pickTemplate } from "@/lib/spider";
import { TEST_TYPES, testTypeMeta as baseTestTypeMeta } from "@/lib/domain";
import { useUnitPrefs } from "@/hooks/use-units";
import { secondsToMph, secondsToMps } from "@/lib/units";

// Known sprint distances in inches, used to convert seconds → mph / m/s
// when the coach's speed preference is set to something other than seconds.
const SPRINT_DIST_IN: Record<string, number> = {
  sprint_10y: 360,
  sprint_20y: 720,
  sprint_40y: 1440,
};

// ---------- Types ----------
type Point = { date: string; value: number };
type KpiKey = string;
type KpiComputed = {
  key: KpiKey;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  series: Point[]; // ascending by date
  current: number | null;
  previous: number | null;
  best: number | null;
  bestDate: string | null;
  currentDate: string | null;
};
type Status = "pr" | "up" | "warn" | "down" | "none";

type Ctx = {
  athlete: Athlete;
  tests: TestRow[];
  lifts: LiftRow[];
  attendance: AttendanceRow[];
  repMaxes: RepMax[];
  testMeta: (v: string) => { label: string; unit: string; lowerIsBetter: boolean };
};

// ---------- Helpers ----------
function daysAgoISO(days: number) {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function fmt(v: number | null | undefined, unit: string) {
  if (v == null || !Number.isFinite(v)) return "—";
  const digits = unit === "reps" ? 0 : 2;
  return `${v.toFixed(digits)}${unit ? unit : ""}`;
}

function pctChange(prev: number | null, cur: number | null, lowerIsBetter: boolean) {
  if (prev == null || cur == null || prev === 0) return null;
  const raw = lowerIsBetter ? (prev - cur) / prev : (cur - prev) / prev;
  return raw * 100;
}

function computeStatus(k: KpiComputed): Status {
  if (k.current == null) return "none";
  if (k.best != null && k.current === k.best && (k.series.length === 1 || k.previous == null || (k.lowerIsBetter ? k.current < k.previous : k.current > k.previous))) {
    return "pr";
  }
  if (k.previous == null) return "none";
  const delta = k.lowerIsBetter ? (k.previous - k.current) / k.previous : (k.current - k.previous) / k.previous;
  if (delta > 0.001) return "up";
  if (delta < -0.001) return "down";
  // within 95% of PR?
  if (k.best != null) {
    const within = k.lowerIsBetter ? k.current <= k.best * 1.05 : k.current >= k.best * 0.95;
    if (within) return "warn";
  }
  return "warn";
}

const STATUS_COLOR: Record<Status, string> = {
  pr: "var(--status-pr)",
  up: "var(--status-info)",
  warn: "var(--status-near)",
  down: "var(--status-below)",
  none: "var(--status-neutral)",
};

const STATUS_LABEL: Record<Status, string> = {
  pr: "PR",
  up: "Improving",
  warn: "Near best",
  down: "Declining",
  none: "No data",
};

// ---------- Series builders ----------
function bestPerDate(rows: { date: string; value: number }[], lowerIsBetter: boolean): Point[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const cur = map.get(r.date);
    if (cur == null || (lowerIsBetter ? r.value < cur : r.value > cur)) map.set(r.date, r.value);
  }
  return Array.from(map.entries()).map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

function testSeries(ctx: Ctx, testType: string): Point[] {
  const meta = ctx.testMeta(testType);
  return bestPerDate(
    ctx.tests.filter((t) => t.athlete_id === ctx.athlete.id && t.test_type === testType).map((t) => ({ date: t.test_date, value: Number(t.value) })),
    meta.lowerIsBetter,
  );
}

function liftSeries(ctx: Ctx, exerciseNameLike: string[], measurement: "load" | "time" = "load"): Point[] {
  const target = new Set(exerciseNameLike.map((s) => s.toLowerCase()));
  const rows = ctx.lifts.filter((l) => l.athlete_id === ctx.athlete.id && target.has((l.exercise ?? "").toLowerCase()));
  const out: { date: string; value: number }[] = [];
  for (const l of rows) {
    const v = measurement === "time" ? l.time_seconds : l.load;
    if (v != null) out.push({ date: l.lift_date, value: Number(v) });
  }
  return bestPerDate(out, measurement === "time");
}

function est1RMSeries(ctx: Ctx): Point[] {
  const rows = ctx.repMaxes
    .filter((r) => r.athlete_id === ctx.athlete.id)
    .map((r) => ({ date: r.tested_at, value: r.reps > 1 ? Number(r.load) * (1 + r.reps / 30) : Number(r.load) }));
  return bestPerDate(rows, false);
}

function attendancePctSeries(ctx: Ctx, windowDays = 14): Point[] {
  // Rolling attendance % over trailing `windowDays` at each session date
  const mine = ctx.attendance.filter((a) => a.athlete_id === ctx.athlete.id).slice().sort((a, b) => a.session_date.localeCompare(b.session_date));
  if (!mine.length) return [];
  const out: Point[] = [];
  for (let i = 0; i < mine.length; i++) {
    const endDate = mine[i].session_date;
    const start = new Date(endDate); start.setDate(start.getDate() - windowDays);
    const startISO = start.toISOString().slice(0, 10);
    const window = mine.filter((a) => a.session_date >= startISO && a.session_date <= endDate);
    const pct = (window.filter((a) => a.present).length / window.length) * 100;
    out.push({ date: endDate, value: pct });
  }
  return out;
}

function consistencySeries(ctx: Ctx): Point[] {
  // Weekly workout count (lifts distinct dates) over last 12 weeks, mapped to 0-100 (>=3/wk = 100)
  const mine = ctx.lifts.filter((l) => l.athlete_id === ctx.athlete.id);
  const byWeek = new Map<string, Set<string>>();
  for (const l of mine) {
    const d = new Date(l.lift_date);
    const y = d.getUTCFullYear();
    const first = new Date(Date.UTC(y, 0, 1));
    const wk = Math.floor((d.getTime() - first.getTime()) / (7 * 86400000));
    const key = `${y}-W${String(wk).padStart(2, "0")}`;
    if (!byWeek.has(key)) byWeek.set(key, new Set());
    byWeek.get(key)!.add(l.lift_date);
  }
  return Array.from(byWeek.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([_, dates]) => ({ date: Array.from(dates).sort().slice(-1)[0], value: Math.min(100, (dates.size / 3) * 100) }));
}

// ---------- KPI definitions ----------
type KpiDef = {
  key: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  build: (ctx: Ctx) => Point[];
};

const KPI_DEFS: KpiDef[] = [
  { key: "sprint_10y", label: "10 Yard Fly", unit: "s", lowerIsBetter: true, build: (c) => testSeries(c, "sprint_10y") },
  { key: "sprint_20y", label: "20 Yard Fly", unit: "s", lowerIsBetter: true, build: (c) => testSeries(c, "sprint_20y") },
  { key: "sprint_40y", label: "40 Yard Fly", unit: "s", lowerIsBetter: true, build: (c) => testSeries(c, "sprint_40y") },
  { key: "top_speed", label: "Top Speed", unit: "mph", lowerIsBetter: false, build: (c) => testSeries(c, "top_speed") },
  { key: "vertical_jump", label: "Vertical Jump", unit: "in", lowerIsBetter: false, build: (c) => testSeries(c, "vertical_jump") },
  { key: "broad_jump", label: "Broad Jump", unit: "in", lowerIsBetter: false, build: (c) => testSeries(c, "broad_jump") },
  { key: "rsi", label: "RSI", unit: "", lowerIsBetter: false, build: (c) => testSeries(c, "rsi") },
  { key: "est_1rm", label: "Est 1RM (top)", unit: "lb", lowerIsBetter: false, build: (c) => est1RMSeries(c) },
  {
    key: "rel_strength",
    label: "Relative Strength",
    unit: "x BW",
    lowerIsBetter: false,
    build: (c) => {
      const bw = c.athlete.bodyweight;
      if (!bw || bw <= 0) return [];
      return est1RMSeries(c).map((p) => ({ date: p.date, value: p.value / bw }));
    },
  },
  {
    key: "bodyweight",
    label: "Bodyweight",
    unit: "lb",
    lowerIsBetter: false,
    build: (c) => (c.athlete.bodyweight ? [{ date: new Date().toISOString().slice(0, 10), value: Number(c.athlete.bodyweight) }] : []),
  },
  { key: "attendance_pct", label: "Attendance", unit: "%", lowerIsBetter: false, build: (c) => attendancePctSeries(c) },
  { key: "consistency", label: "Training Consistency", unit: "%", lowerIsBetter: false, build: (c) => consistencySeries(c) },
  { key: "last_workout", label: "Days Since Workout", unit: "d", lowerIsBetter: true, build: (c) => {
    const mine = c.lifts.filter((l) => l.athlete_id === c.athlete.id).map((l) => l.lift_date).sort();
    if (!mine.length) return [];
    const last = mine[mine.length - 1];
    const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
    return [{ date: last, value: days }];
  } },
];

const DEFAULT_KPI_KEYS = [
  "sprint_10y", "sprint_20y", "sprint_40y", "top_speed",
  "vertical_jump", "broad_jump", "rsi",
  "est_1rm", "rel_strength", "bodyweight",
  "attendance_pct", "consistency", "last_workout",
];

function computeKpi(def: KpiDef, ctx: Ctx): KpiComputed {
  const series = def.build(ctx);
  if (!series.length) {
    return { key: def.key, label: def.label, unit: def.unit, lowerIsBetter: def.lowerIsBetter, series, current: null, previous: null, best: null, bestDate: null, currentDate: null };
  }
  const current = series[series.length - 1];
  const previous = series.length >= 2 ? series[series.length - 2] : null;
  let best = series[0];
  for (const p of series) {
    if (def.lowerIsBetter ? p.value < best.value : p.value > best.value) best = p;
  }
  return {
    key: def.key, label: def.label, unit: def.unit, lowerIsBetter: def.lowerIsBetter,
    series, current: current.value, previous: previous?.value ?? null, best: best.value, bestDate: best.date, currentDate: current.date,
  };
}

// ---------- Sparkline ----------
function Sparkline({ points, lowerIsBetter, color, width = 96, height = 28 }: { points: Point[]; lowerIsBetter: boolean; color: string; width?: number; height?: number }) {
  if (points.length < 2) return <div style={{ width, height }} />;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const y = (v: number) => {
    const norm = (v - min) / range; // 0..1, higher = better position (top) when higher is better
    return lowerIsBetter ? norm * (height - 2) + 1 : (1 - norm) * (height - 2) + 1;
  };
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      <circle cx={(points.length - 1) * step} cy={y(last.value)} r={2} fill={color} />
    </svg>
  );
}

// ---------- KPI Card ----------
type Window = "30d" | "90d" | "season" | "career";
function windowFilter(points: Point[], w: Window): Point[] {
  if (w === "career") return points;
  if (w === "season") {
    const y = new Date().getUTCFullYear();
    return points.filter((p) => p.date >= `${y}-01-01`);
  }
  const cutoff = daysAgoISO(w === "30d" ? 30 : 90);
  return points.filter((p) => p.date >= cutoff);
}

function KpiCard({ k, window, showSparkline = true, highlightPb = true }: { k: KpiComputed; window: Window; showSparkline?: boolean; highlightPb?: boolean }) {
  const filtered = useMemo(() => {
    const f = windowFilter(k.series, window);
    return f.length ? f : k.series.slice(-8);
  }, [k.series, window]);
  const view: KpiComputed = useMemo(() => {
    if (filtered === k.series || filtered.length === k.series.length) return k;
    if (!filtered.length) return { ...k, current: null, previous: null, best: null };
    const current = filtered[filtered.length - 1].value;
    const previous = filtered.length >= 2 ? filtered[filtered.length - 2].value : null;
    let best = filtered[0].value;
    for (const p of filtered) if (k.lowerIsBetter ? p.value < best : p.value > best) best = p.value;
    return { ...k, series: filtered, current, previous, best };
  }, [filtered, k]);

  // Coach can display sprint times as mph / m/s. Convert only KPIs stored in
  // seconds for which we know the sprint distance. Higher speed = better.
  const [prefs] = useUnitPrefs();
  const displayView: KpiComputed = useMemo(() => {
    const dist = SPRINT_DIST_IN[view.key];
    if (!dist || view.unit !== "s" || prefs.speed === "s") return view;
    const conv = (s: number) =>
      prefs.speed === "mph" ? secondsToMph(s, dist) : secondsToMps(s, dist);
    return {
      ...view,
      unit: prefs.speed,
      lowerIsBetter: false,
      series: view.series.map((p) => ({ date: p.date, value: conv(p.value) })),
      current: view.current != null ? conv(view.current) : null,
      previous: view.previous != null ? conv(view.previous) : null,
      best: view.best != null ? conv(view.best) : null,
    };
  }, [view, prefs.speed]);

  const status = computeStatus(displayView);
  const color = STATUS_COLOR[status];
  const pct = pctChange(displayView.previous, displayView.current, displayView.lowerIsBetter);
  const diff = displayView.previous != null && displayView.current != null ? displayView.current - displayView.previous : null;
  const TrendIcon = pct == null ? ArrowRight : pct > 0.05 ? ArrowUp : pct < -0.05 ? ArrowDown : ArrowRight;
  const trendPositive = pct != null && pct > 0.05;
  const trendNegative = pct != null && pct < -0.05;
  const isPb = highlightPb && displayView.current != null && displayView.best != null && displayView.current === displayView.best;

  return (
    <Card
      className={cn("relative overflow-hidden border-border", isPb && "ring-1 ring-[color:var(--status-pr)]/50")}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {displayView.label}
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="stat-number text-2xl leading-none">
                {displayView.current == null ? "—" : displayView.current.toFixed(displayView.unit === "reps" ? 0 : 2)}
              </span>
              {displayView.unit && <span className="text-xs text-muted-foreground">{displayView.unit}</span>}
              {isPb && <Trophy className="h-3.5 w-3.5 text-[color:var(--status-pr)]" aria-label="Personal best" />}
            </div>
          </div>
          <span
            className="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
            style={{
              borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
              color,
              background: `color-mix(in oklab, ${color} 10%, transparent)`,
            }}
          >
            {STATUS_LABEL[status]}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-[11px]">
            <TrendIcon
              className={cn(
                "h-3 w-3",
                trendPositive && "text-[color:var(--status-pr)]",
                trendNegative && "text-[color:var(--status-below)]",
                !trendPositive && !trendNegative && "text-muted-foreground",
              )}
            />
            <span
              className={cn(
                "font-mono tabular-nums",
                trendPositive && "text-[color:var(--status-pr)]",
                trendNegative && "text-[color:var(--status-below)]",
                !trendPositive && !trendNegative && "text-muted-foreground",
              )}
            >
              {pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}
            </span>
            {diff != null && (
              <span className="text-muted-foreground">
                ({diff > 0 ? "+" : ""}{diff.toFixed(displayView.unit === "reps" ? 0 : 2)})
              </span>
            )}
          </div>
          {showSparkline && <Sparkline points={displayView.series} lowerIsBetter={displayView.lowerIsBetter} color={color} />}
        </div>

        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>prev {displayView.previous == null ? "—" : fmt(displayView.previous, displayView.unit)}</span>
          <span>{displayView.currentDate ?? "—"}</span>
        </div>

      </CardContent>
    </Card>
  );
}

// ---------- Snapshot ----------
function useRanks(ctx: Ctx, kpis: KpiComputed[], athletesAll: Athlete[]) {
  return useMemo(() => {
    const norm = (v: string | null) => (v ?? "").trim().toLowerCase();
    const mySport = norm(ctx.athlete.sport);
    const myGender = norm(ctx.athlete.gender);
    const myTeam = ctx.athlete.team_id;
    const myGrade = ctx.athlete.grade;
    const myPosition = norm(ctx.athlete.position);

    function rankIn(pool: Athlete[], kpi: KpiComputed): { rank: number; of: number } | null {
      if (kpi.current == null) return null;
      const bestByAthlete = new Map<string, number>();
      // rebuild best for pool using ctx test/lift arrays
      for (const a of pool) {
        const localCtx = { ...ctx, athlete: a };
        const def = KPI_DEFS.find((d) => d.key === kpi.key);
        if (!def) continue;
        const series = def.build(localCtx);
        if (!series.length) continue;
        let best = series[0].value;
        for (const p of series) if (kpi.lowerIsBetter ? p.value < best : p.value > best) best = p.value;
        bestByAthlete.set(a.id, best);
      }
      const rows = Array.from(bestByAthlete.entries()).sort((a, b) => (kpi.lowerIsBetter ? a[1] - b[1] : b[1] - a[1]));
      const idx = rows.findIndex(([id]) => id === ctx.athlete.id);
      if (idx < 0) return null;
      return { rank: idx + 1, of: rows.length };
    }

    // Pick a representative KPI for ranking: prefer top speed / sprint_40y / est_1rm
    const primary = kpis.find((k) => k.key === "sprint_40y" && k.current != null)
      ?? kpis.find((k) => k.key === "est_1rm" && k.current != null)
      ?? kpis.find((k) => k.current != null);
    if (!primary) return null;

    return {
      primaryLabel: primary.label,
      overall: rankIn(athletesAll, primary),
      sport: rankIn(athletesAll.filter((a) => norm(a.sport) === mySport && mySport), primary),
      team: myTeam ? rankIn(athletesAll.filter((a) => a.team_id === myTeam), primary) : null,
      grade: myGrade ? rankIn(athletesAll.filter((a) => a.grade === myGrade), primary) : null,
      position: myPosition ? rankIn(athletesAll.filter((a) => norm(a.position) === myPosition && norm(a.sport) === mySport), primary) : null,
    };
  }, [ctx, kpis, athletesAll]);
}

function PerformanceSnapshot({ ctx, kpis, athletesAll }: { ctx: Ctx; kpis: KpiComputed[]; athletesAll: Athlete[] }) {
  const ranks = useRanks(ctx, kpis, athletesAll);

  const improvements = kpis
    .filter((k) => k.previous != null && k.current != null)
    .map((k) => ({ label: k.label, pct: pctChange(k.previous, k.current, k.lowerIsBetter) ?? 0 }))
    .sort((a, b) => b.pct - a.pct);
  const mostImproved = improvements[0];
  const needsWork = improvements.filter((i) => i.pct < 0).slice(-1)[0];

  const attendancePct = kpis.find((k) => k.key === "attendance_pct")?.current ?? null;
  const lastWorkoutDays = kpis.find((k) => k.key === "last_workout")?.current ?? null;
  const lastTestDate = ctx.tests.filter((t) => t.athlete_id === ctx.athlete.id).map((t) => t.test_date).sort().slice(-1)[0] ?? null;

  // Overall rating: average of "% of PR" across KPIs with data, mapped 0-100
  const overallRating = useMemo(() => {
    const scores = kpis
      .filter((k) => k.current != null && k.best != null && k.best !== 0)
      .map((k) => {
        const s = k.lowerIsBetter ? (k.best! / k.current!) * 100 : (k.current! / k.best!) * 100;
        return Math.max(0, Math.min(100, s));
      });
    if (!scores.length) return null;
    return scores.reduce((s, v) => s + v, 0) / scores.length;
  }, [kpis]);

  const items: { label: string; value: React.ReactNode; icon: React.ReactNode }[] = [
    { label: "Overall", value: overallRating == null ? "—" : `${overallRating.toFixed(0)}`, icon: <Zap className="h-3.5 w-3.5" /> },
    { label: "Attendance", value: attendancePct == null ? "—" : `${attendancePct.toFixed(0)}%`, icon: <Activity className="h-3.5 w-3.5" /> },
    { label: ranks?.primaryLabel ? `${ranks.primaryLabel} rank` : "Rank", value: ranks?.overall ? `#${ranks.overall.rank}/${ranks.overall.of}` : "—", icon: <Trophy className="h-3.5 w-3.5" /> },
    { label: "Sport", value: ranks?.sport ? `#${ranks.sport.rank}/${ranks.sport.of}` : "—", icon: <Award className="h-3.5 w-3.5" /> },
    { label: "Team", value: ranks?.team ? `#${ranks.team.rank}/${ranks.team.of}` : "—", icon: <Award className="h-3.5 w-3.5" /> },
    { label: "Grade", value: ranks?.grade ? `#${ranks.grade.rank}/${ranks.grade.of}` : "—", icon: <Award className="h-3.5 w-3.5" /> },
    { label: "Position", value: ranks?.position ? `#${ranks.position.rank}/${ranks.position.of}` : "—", icon: <Award className="h-3.5 w-3.5" /> },
    { label: "Most improved", value: mostImproved && mostImproved.pct > 0 ? `${mostImproved.label} +${mostImproved.pct.toFixed(1)}%` : "—", icon: <Flame className="h-3.5 w-3.5" /> },
    { label: "Needs work", value: needsWork ? `${needsWork.label} ${needsWork.pct.toFixed(1)}%` : "—", icon: <Dumbbell className="h-3.5 w-3.5" /> },
    { label: "Last workout", value: lastWorkoutDays == null ? "—" : lastWorkoutDays === 0 ? "Today" : `${lastWorkoutDays}d ago`, icon: <Activity className="h-3.5 w-3.5" /> },
    { label: "Last test", value: lastTestDate ?? "—", icon: <Activity className="h-3.5 w-3.5" /> },
  ];

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((it) => (
          <div key={it.label} className="min-w-0">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {it.icon}<span className="truncate">{it.label}</span>
            </div>
            <div className="mt-0.5 truncate stat-number text-sm">{it.value}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------- Progress bars ----------
function percentile(pool: number[], value: number, lowerIsBetter: boolean) {
  if (!pool.length) return null;
  const better = pool.filter((v) => (lowerIsBetter ? v < value : v > value)).length;
  const total = pool.length;
  return Math.max(0, Math.min(100, ((total - better) / total) * 100));
}

function ProgressBars({ ctx, athletesAll }: { ctx: Ctx; athletesAll: Athlete[] }) {
  const norm = (v: string | null) => (v ?? "").trim().toLowerCase();
  const mySport = norm(ctx.athlete.sport);
  const myGender = norm(ctx.athlete.gender);
  const pool = athletesAll.filter((a) => (!mySport || norm(a.sport) === mySport) && (!myGender || norm(a.gender) === myGender));

  function poolValues(def: KpiDef): { pool: number[]; mine: number | null } {
    const vals: number[] = [];
    let mine: number | null = null;
    for (const a of pool) {
      const series = def.build({ ...ctx, athlete: a });
      if (!series.length) continue;
      let best = series[0].value;
      for (const p of series) if (def.lowerIsBetter ? p.value < best : p.value > best) best = p.value;
      vals.push(best);
      if (a.id === ctx.athlete.id) mine = best;
    }
    return { pool: vals, mine };
  }

  const speedDef = KPI_DEFS.find((k) => k.key === "sprint_40y")!;
  const strengthDef = KPI_DEFS.find((k) => k.key === "est_1rm")!;
  const attDef = KPI_DEFS.find((k) => k.key === "attendance_pct")!;
  const conDef = KPI_DEFS.find((k) => k.key === "consistency")!;

  const speed = poolValues(speedDef);
  const strength = poolValues(strengthDef);
  const attendance = poolValues(attDef);
  const consistency = poolValues(conDef);

  const bars = [
    { label: "Speed", value: speed.mine != null ? percentile(speed.pool, speed.mine, speedDef.lowerIsBetter) : null, sub: "vs same sport/gender" },
    { label: "Strength", value: strength.mine != null ? percentile(strength.pool, strength.mine, strengthDef.lowerIsBetter) : null, sub: "vs same sport/gender" },
    { label: "Attendance", value: attendance.mine, sub: "trailing 14 sessions" },
    { label: "Consistency", value: consistency.mine, sub: "workouts per week" },
  ];

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {bars.map((b) => (
          <div key={b.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{b.label}</span>
              <span className="stat-number tabular-nums">{b.value == null ? "—" : `${b.value.toFixed(0)}`}<span className="ml-0.5 text-[10px] text-muted-foreground">/100</span></span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${b.value ?? 0}%`, background: b.value == null ? "transparent" : "var(--color-primary)" }}
              />
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{b.sub}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------- Personal Records ----------
function PersonalRecords({ ctx }: { ctx: Ctx }) {
  const recentCutoff = daysAgoISO(14);

  const testPRs: { label: string; value: string; date: string; recent: boolean }[] = [];
  for (const def of KPI_DEFS) {
    if (!["sprint_10y", "sprint_20y", "sprint_40y", "top_speed", "vertical_jump", "broad_jump", "rsi"].includes(def.key)) continue;
    const series = def.build(ctx);
    if (!series.length) continue;
    let best = series[0];
    for (const p of series) if (def.lowerIsBetter ? p.value < best.value : p.value > best.value) best = p;
    testPRs.push({ label: def.label, value: fmt(best.value, def.unit), date: best.date, recent: best.date >= recentCutoff });
  }

  // Lift PRs by exercise from rep_maxes (e1RM per exercise)
  const liftPRs = useMemo(() => {
    const map = new Map<string, { e1rm: number; date: string; load: number; reps: number }>();
    for (const r of ctx.repMaxes.filter((x) => x.athlete_id === ctx.athlete.id)) {
      const e = r.reps > 1 ? Number(r.load) * (1 + r.reps / 30) : Number(r.load);
      const cur = map.get(r.exercise_name);
      if (!cur || e > cur.e1rm) map.set(r.exercise_name, { e1rm: e, date: r.tested_at, load: Number(r.load), reps: r.reps });
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.e1rm - a.e1rm)
      .slice(0, 8);
  }, [ctx.repMaxes, ctx.athlete.id]);

  // Best attendance streak (consecutive presents on sorted session dates)
  const streak = useMemo(() => {
    const mine = ctx.attendance.filter((a) => a.athlete_id === ctx.athlete.id).slice().sort((a, b) => a.session_date.localeCompare(b.session_date));
    let best = 0, cur = 0;
    for (const a of mine) { if (a.present) { cur++; if (cur > best) best = cur; } else cur = 0; }
    return best;
  }, [ctx.attendance, ctx.athlete.id]);

  const mostRecentPR = [...testPRs, ...liftPRs.map((l) => ({ label: l.name, value: `${Math.round(l.e1rm)} lb e1RM`, date: l.date, recent: l.date >= recentCutoff }))]
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Personal Records</h3>
          {mostRecentPR && <Badge variant="outline" className="text-[10px]">Latest: {mostRecentPR.label} · {mostRecentPR.date}</Badge>}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {testPRs.length === 0 && liftPRs.length === 0 && (
            <div className="col-span-2 py-4 text-center text-sm text-muted-foreground">No records yet.</div>
          )}
          {testPRs.map((p) => (
            <div key={p.label} className="flex items-center justify-between rounded-md border border-border/60 p-2">
              <div className="min-w-0">
                <div className="truncate text-xs text-muted-foreground">{p.label}</div>
                <div className="stat-number text-base">{p.value}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground">{p.date}</div>
                {p.recent && <Badge className="mt-1 text-[9px]" style={{ background: "var(--kpi-pr)", color: "#000" }}>NEW PR</Badge>}
              </div>
            </div>
          ))}
          {liftPRs.map((l) => (
            <div key={l.name} className="flex items-center justify-between rounded-md border border-border/60 p-2">
              <div className="min-w-0">
                <div className="truncate text-xs text-muted-foreground">{l.name}</div>
                <div className="stat-number text-base">{Math.round(l.e1rm / 5) * 5} <span className="text-xs text-muted-foreground">lb e1RM</span></div>
                <div className="text-[10px] text-muted-foreground">from {l.load} × {l.reps}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground">{l.date}</div>
                {l.date >= recentCutoff && <Badge className="mt-1 text-[9px]" style={{ background: "var(--kpi-pr)", color: "#000" }}>NEW PR</Badge>}
              </div>
            </div>
          ))}
        </div>

        {streak > 0 && (
          <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
            <span className="text-muted-foreground">Best attendance streak</span>
            <span className="stat-number">{streak} sessions</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Custom metric KPI ----------
function customMetricDef(cm: CustomMetric, allAthletes: Athlete[], customTypes: CustomTestType[]): KpiDef {
  return {
    key: `custom:${cm.id}`,
    label: cm.name,
    unit: cm.unit ?? "",
    lowerIsBetter: !!cm.lower_is_better,
    build: (c) => {
      const rows = computeMetric(cm, allAthletes, c.tests, c.lifts, c.attendance, {}, customTypes);
      const mine = rows.find((r) => r.athlete.id === c.athlete.id);
      return mine ? [{ date: mine.date, value: mine.value }] : [];
    },
  };
}

// ---------- Pin persistence ----------
type PinRow = { id: string; user_id: string; athlete_id: string | null; metric_key: string; position: number };

function usePins(athleteId: string) {
  return useQuery({
    queryKey: ["athlete_kpi_pins", athleteId],
    queryFn: async (): Promise<PinRow[]> => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) return [];
      const { data, error } = await supabase
        .from("athlete_kpi_pins" as never)
        .select("*")
        .eq("user_id", uid)
        .or(`athlete_id.eq.${athleteId},athlete_id.is.null`)
        .order("position");
      if (error) throw error;
      return (data ?? []) as unknown as PinRow[];
    },
  });
}

function usePinMutations(athleteId: string) {
  const qc = useQueryClient();
  const savePins = useMutation({
    mutationFn: async (keys: string[]) => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Not signed in");
      // Replace all pins for this (user, athlete)
      const { error: delErr } = await supabase
        .from("athlete_kpi_pins" as never)
        .delete()
        .eq("user_id", uid)
        .eq("athlete_id", athleteId);
      if (delErr) throw delErr;
      if (!keys.length) return;
      const rows = keys.map((k, i) => ({ user_id: uid, athlete_id: athleteId, metric_key: k, position: i }));
      const { error } = await supabase.from("athlete_kpi_pins" as never).insert(rows as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["athlete_kpi_pins", athleteId] });
      toast.success("Dashboard updated");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });
  return { savePins };
}

// ---------- Customize sheet ----------
function CustomizeSheet({
  allDefs, activeKeys, onSave,
}: {
  allDefs: KpiDef[];
  activeKeys: string[];
  onSave: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(activeKeys);

  // Keep draft in sync when opening
  function onOpenChange(o: boolean) {
    if (o) setDraft(activeKeys);
    setOpen(o);
  }

  const inSet = new Set(draft);
  const available = allDefs.filter((d) => !inSet.has(d.key));

  function move(i: number, dir: -1 | 1) {
    const next = draft.slice();
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]"><Settings2 className="h-3 w-3" /> Customize</Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Customize KPI cards</SheetTitle>
          <SheetDescription>Pin the metrics that matter for this athlete. Order top-to-bottom is left-to-right on the dashboard.</SheetDescription>
        </SheetHeader>

        <ScrollArea className="mt-3 h-[calc(100vh-220px)] pr-3">
          <div className="space-y-4">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pinned ({draft.length})</div>
              {draft.length === 0 && <div className="text-xs text-muted-foreground">Nothing pinned. Add from below.</div>}
              <ul className="space-y-1">
                {draft.map((key, i) => {
                  const def = allDefs.find((d) => d.key === key);
                  return (
                    <li key={key} className="flex items-center gap-2 rounded-md border border-border/60 p-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{def?.label ?? key}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => move(i, -1)} disabled={i === 0}><ChevronUp className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => move(i, 1)} disabled={i === draft.length - 1}><ChevronDown className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDraft(draft.filter((k) => k !== key))}><X className="h-3 w-3" /></Button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Available ({available.length})</div>
              <ul className="space-y-1">
                {available.map((def) => (
                  <li key={def.key} className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-muted/50">
                    <Checkbox checked={false} onCheckedChange={() => setDraft([...draft, def.key])} />
                    <span className="min-w-0 flex-1 truncate">{def.label}</span>
                    {def.key.startsWith("custom:") && <Badge variant="outline" className="text-[9px]">custom</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </ScrollArea>

        <SheetFooter className="mt-3 flex-row gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDraft(DEFAULT_KPI_KEYS)}>Reset defaults</Button>
          <Button size="sm" onClick={() => { onSave(draft); setOpen(false); }}>Save</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------- Main dashboard ----------
export function AthleteKpiDashboard({
  athlete, tests, lifts, attendance, repMaxes, customTypes, athletesAll,
}: {
  athlete: Athlete;
  tests: TestRow[];
  lifts: LiftRow[];
  attendance: AttendanceRow[];
  repMaxes: RepMax[];
  customTypes: CustomTestType[];
  athletesAll: Athlete[];
}) {
  const testMeta = useMemo(() => {
    const m = new Map(customTypes.map((c) => [c.value, { label: c.label, unit: c.unit, lowerIsBetter: c.lower_is_better }]));
    return (v: string) => m.get(v) ?? { label: baseTestTypeMeta(v).label, unit: baseTestTypeMeta(v).unit, lowerIsBetter: baseTestTypeMeta(v).lowerIsBetter };
  }, [customTypes]);

  const { data: customMetrics = [] } = useQuery(customMetricsQO);
  const { data: pins = [] } = usePins(athlete.id);
  const { savePins } = usePinMutations(athlete.id);
  const { data: spiderTemplates = [] } = useQuery(spiderTemplatesQO);
  const dashboardTemplate = useMemo(() => pickTemplate(spiderTemplates, athlete), [spiderTemplates, athlete]);
  const showSparkline = dashboardTemplate?.kpi_config?.sparkline ?? true;
  const highlightPb = dashboardTemplate?.kpi_config?.highlight_pb ?? true;
  const showProgress = dashboardTemplate?.options?.show_progress ?? true;
  const showPrs = dashboardTemplate?.options?.show_prs ?? true;

  const ctx: Ctx = { athlete, tests, lifts, attendance, repMaxes, testMeta };

  // All possible KPI defs = built-ins + one per custom metric
  const allDefs = useMemo(() => {
    const customDefs = customMetrics.map((cm) => customMetricDef(cm, athletesAll, customTypes));
    return [...KPI_DEFS, ...customDefs];
  }, [customMetrics, athletesAll, customTypes]);

  // Active keys: prefer per-athlete pins, then defaults
  const activeKeys = useMemo(() => {
    const perAthlete = pins.filter((p) => p.athlete_id === athlete.id).sort((a, b) => a.position - b.position).map((p) => p.metric_key);
    if (perAthlete.length) return perAthlete;
    return DEFAULT_KPI_KEYS;
  }, [pins, athlete.id]);

  const kpis = useMemo(() => {
    return activeKeys
      .map((k) => allDefs.find((d) => d.key === k))
      .filter((d): d is KpiDef => !!d)
      .map((d) => computeKpi(d, ctx));
  }, [activeKeys, allDefs, ctx]);

  const [win, setWin] = useState<Window>("season");

  const withData = kpis.filter((k) => k.current != null);
  const withoutData = kpis.filter((k) => k.current == null);

  void TEST_TYPES;

  return (
    <div className="space-y-4">
      <PerformanceSnapshot ctx={ctx} kpis={withData} athletesAll={athletesAll} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Key Metrics</h2>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-md border border-border p-0.5 text-[11px]">
            {(["30d", "90d", "season", "career"] as Window[]).map((w) => (
              <button
                key={w}
                onClick={() => setWin(w)}
                className={cn("rounded px-2 py-1 capitalize", win === w ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {w === "30d" ? "30 d" : w === "90d" ? "90 d" : w}
              </button>
            ))}
          </div>
          <CustomizeSheet allDefs={allDefs} activeKeys={activeKeys} onSave={(k) => savePins.mutate(k)} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {withData.map((k) => (
          <KpiCard key={k.key} k={k} window={win} showSparkline={showSparkline} highlightPb={highlightPb} />
        ))}
      </div>

      {withoutData.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          No data yet for: {withoutData.map((k) => k.label).join(", ")}
        </div>
      )}

      {(showProgress || showPrs) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {showProgress && <ProgressBars ctx={ctx} athletesAll={athletesAll} />}
          {showPrs && <PersonalRecords ctx={ctx} />}
        </div>
      )}
    </div>
  );
}
