// The "look at a specific athlete" side of the Performance Dashboard: identity
// header, spider chart, a small-multiples grid of real trend line charts (one
// per tracked metric, not a sparkline), percentile bars vs a peer group, and a
// PR shelf — built to read like a report a strength coach hands a sport coach,
// not a settings page.
import { useMemo } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Trophy, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  athleteDisplayName,
  type Athlete,
  type TestRow,
  type RepMax,
  type CustomTestType,
} from "@/lib/queries";
import {
  allReportMetrics,
  reportSeries,
  withPRFlags,
  percentileRank,
  type FlaggedPoint,
} from "@/lib/dashboard-report-metrics";
import { AthleteSpiderGraph } from "@/components/athlete-spider-graph";

const KEY_METRIC_KEYS = [
  "test:sprint_40y",
  "test:vertical_jump",
  "test:broad_jump",
  "test:pro_agility",
];

export function AthleteAnalyticsPanel({
  athlete,
  peers,
  tests,
  repMaxes,
  customTypes,
}: {
  athlete: Athlete;
  peers: Athlete[];
  tests: TestRow[];
  repMaxes: RepMax[];
  customTypes: CustomTestType[];
}) {
  const allMetrics = useMemo(
    () => allReportMetrics(customTypes, repMaxes),
    [customTypes, repMaxes],
  );

  const trends = useMemo(() => {
    return allMetrics
      .map((m) => {
        const series = withPRFlags(reportSeries(m, athlete.id, tests, repMaxes), m.lowerIsBetter);
        return { metric: m, series };
      })
      .filter((t) => t.series.length >= 2)
      .sort((a, b) =>
        b.series[b.series.length - 1].date.localeCompare(a.series[a.series.length - 1].date),
      )
      .slice(0, 6);
  }, [allMetrics, athlete.id, tests, repMaxes]);

  const percentiles = useMemo(() => {
    const pool = peers.filter((p) => p.id !== athlete.id);
    return KEY_METRIC_KEYS.map((key) => {
      const metric = allMetrics.find((m) => m.key === key);
      if (!metric) return null;
      const mine = reportSeries(metric, athlete.id, tests, repMaxes);
      if (!mine.length) return null;
      const myBest = metric.lowerIsBetter
        ? Math.min(...mine.map((p) => p.value))
        : Math.max(...mine.map((p) => p.value));
      const poolBests = pool
        .map((p) => reportSeries(metric, p.id, tests, repMaxes))
        .filter((s) => s.length)
        .map((s) =>
          metric.lowerIsBetter
            ? Math.min(...s.map((p) => p.value))
            : Math.max(...s.map((p) => p.value)),
        );
      const pct = percentileRank(poolBests, myBest, metric.lowerIsBetter);
      return pct == null ? null : { metric, value: myBest, pct };
    }).filter(
      (x): x is { metric: (typeof allMetrics)[number]; value: number; pct: number } => x != null,
    );
  }, [peers, athlete.id, allMetrics, tests, repMaxes]);

  const recentPRs = useMemo(() => {
    const items: { label: string; value: number; unit: string; date: string }[] = [];
    for (const m of allMetrics) {
      const series = withPRFlags(reportSeries(m, athlete.id, tests, repMaxes), m.lowerIsBetter);
      const lastPR = [...series].reverse().find((p) => p.isPR);
      if (lastPR)
        items.push({ label: m.label, value: lastPR.value, unit: m.unit, date: lastPR.date });
    }
    return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  }, [allMetrics, athlete.id, tests, repMaxes]);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-border/60">
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <div className="min-w-0">
            <div className="text-lg font-semibold">{athleteDisplayName(athlete)}</div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              {athlete.position && <Badge variant="outline">{athlete.position}</Badge>}
              {athlete.grade != null && <Badge variant="outline">Grade {athlete.grade}</Badge>}
              {athlete.sport && <Badge variant="outline">{athlete.sport}</Badge>}
            </div>
          </div>
        </CardContent>
      </Card>

      <AthleteSpiderGraph athlete={athlete} />

      {percentiles.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Percentile vs peers
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {percentiles.map((p) => (
              <div key={p.metric.key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{p.metric.label}</span>
                  <span className="stat-number tabular-nums">
                    {p.value.toFixed(p.metric.unit === "lb" ? 0 : 2)} {p.metric.unit}
                    <span className="ml-1.5 text-[10px] text-muted-foreground">
                      {Math.round(p.pct)}th pct
                    </span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${p.pct}%`,
                      background:
                        p.pct >= 75
                          ? "var(--status-pr)"
                          : p.pct >= 50
                            ? "var(--status-info)"
                            : p.pct >= 25
                              ? "var(--status-near)"
                              : "var(--status-below)",
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {recentPRs.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <Trophy className="h-3.5 w-3.5" /> Personal records
            </div>
          </CardHeader>
          <CardContent className="flex gap-2 overflow-x-auto pb-1">
            {recentPRs.map((pr) => (
              <div
                key={pr.label}
                className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              >
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {pr.label}
                </div>
                <div className="stat-number text-base">
                  {pr.value.toFixed(pr.unit === "lb" ? 0 : 2)}{" "}
                  <span className="text-xs text-muted-foreground">{pr.unit}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">{pr.date}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {trends.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Performance trends
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {trends.map((t) => (
              <TrendMiniChart
                key={t.metric.key}
                label={t.metric.label}
                unit={t.metric.unit}
                lowerIsBetter={t.metric.lowerIsBetter}
                series={t.series}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrendMiniChart({
  label,
  unit,
  lowerIsBetter,
  series,
}: {
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  series: FlaggedPoint[];
}) {
  const current = series[series.length - 1];
  const previous = series.length >= 2 ? series[series.length - 2] : null;
  const delta = previous
    ? lowerIsBetter
      ? previous.value - current.value
      : current.value - previous.value
    : null;
  const TrendIcon =
    delta == null || Math.abs(delta) < 1e-9 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const positive = delta != null && delta > 1e-9;
  const negative = delta != null && delta < -1e-9;
  const best = lowerIsBetter
    ? Math.min(...series.map((p) => p.value))
    : Math.max(...series.map((p) => p.value));

  return (
    <Card className="border-border/60">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="stat-number text-xl">
                {current.value.toFixed(unit === "lb" ? 0 : 2)}
              </span>
              <span className="text-xs text-muted-foreground">{unit}</span>
              {current.isPR && (
                <Trophy
                  className="h-3.5 w-3.5 text-[color:var(--status-pr)]"
                  aria-label="Personal best"
                />
              )}
            </div>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
              positive
                ? "text-[color:var(--status-pr)]"
                : negative
                  ? "text-[color:var(--status-below)]"
                  : "text-muted-foreground"
            }`}
          >
            <TrendIcon className="h-3 w-3" />
            {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(unit === "lb" ? 0 : 2)}`}
          </span>
        </div>
        <div className="mt-2 h-[90px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 4, left: -28, bottom: -8 }}>
              <XAxis dataKey="date" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <ReferenceLine
                y={best}
                stroke="var(--status-pr)"
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  fontSize: 11,
                }}
                labelFormatter={(d) => String(d)}
                formatter={(v: number) => [`${v.toFixed(unit === "lb" ? 0 : 2)} ${unit}`, label]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--primary)"
                strokeWidth={2}
                isAnimationActive={false}
                dot={(props: {
                  cx?: number;
                  cy?: number;
                  index?: number;
                  payload?: FlaggedPoint;
                }) => {
                  const { cx, cy, index, payload } = props;
                  if (cx == null || cy == null) return <g key={index} />;
                  if (!payload?.isPR)
                    return (
                      <circle
                        key={index}
                        cx={cx}
                        cy={cy}
                        r={2}
                        fill="var(--primary)"
                        opacity={0.6}
                      />
                    );
                  return (
                    <circle
                      key={index}
                      cx={cx}
                      cy={cy}
                      r={3.5}
                      fill="var(--status-pr)"
                      stroke="var(--card)"
                      strokeWidth={1}
                    />
                  );
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
