// Group-level trend report: pick a grouping dimension (team, position, grade,
// sport) and a metric, and see how each group's average has moved over time —
// the "is this position group getting faster" question a raw snapshot table
// can't answer. Line color is assigned from a fixed, CVD-validated categorical
// slot order per group identity (see src/styles.css --series-1..8), stable
// across filter changes within the same grouping dimension.
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { Athlete, TestRow, RepMax, CustomTestType, Team } from "@/lib/queries";
import {
  allReportMetrics,
  groupedTrend,
  type TrendBucket,
  type ReportMetric,
} from "@/lib/dashboard-report-metrics";

const SERIES_VARS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];
const MAX_SERIES = SERIES_VARS.length;

type GroupDim = "team" | "position" | "grade" | "sport";
const DIM_OPTIONS: { value: GroupDim; label: string }[] = [
  { value: "team", label: "Team" },
  { value: "position", label: "Position" },
  { value: "grade", label: "Grade" },
  { value: "sport", label: "Sport" },
];
const RANGE_OPTIONS = [
  { value: "8", label: "Last 8" },
  { value: "12", label: "Last 12" },
  { value: "26", label: "Last 26" },
  { value: "999", label: "All time" },
];

export function GroupTrendChart({
  athletes,
  tests,
  repMaxes,
  customTypes,
  teams,
}: {
  athletes: Athlete[];
  tests: TestRow[];
  repMaxes: RepMax[];
  customTypes: CustomTestType[];
  teams: Team[];
}) {
  const allMetrics = useMemo(
    () => allReportMetrics(customTypes, repMaxes),
    [customTypes, repMaxes],
  );
  const [metricKey, setMetricKey] = useState(() => allMetrics[0]?.key ?? "");
  const metric: ReportMetric | null =
    allMetrics.find((m) => m.key === metricKey) ?? allMetrics[0] ?? null;

  const [dim, setDim] = useState<GroupDim>("team");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [bucket, setBucket] = useState<TrendBucket>("week");
  const [range, setRange] = useState("12");

  const pool = useMemo(
    () =>
      dim === "team" || teamFilter === "all"
        ? athletes
        : athletes.filter((a) => a.team_id === teamFilter),
    [athletes, dim, teamFilter],
  );

  const teamNameById = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);

  const groupOf = useMemo(() => {
    return (athleteId: string): { key: string; label: string } | null => {
      const a = athletes.find((x) => x.id === athleteId);
      if (!a) return null;
      if (dim === "team")
        return a.team_id
          ? { key: a.team_id, label: teamNameById.get(a.team_id) ?? "Unknown team" }
          : null;
      if (dim === "position") return a.position ? { key: a.position, label: a.position } : null;
      if (dim === "grade")
        return a.grade != null ? { key: String(a.grade), label: `Grade ${a.grade}` } : null;
      return a.sport ? { key: a.sport, label: a.sport } : null;
    };
  }, [athletes, dim, teamNameById]);

  // Full (unfiltered) label set per dimension, so a color slot stays with its
  // entity even as the team filter narrows which groups are actually plotted.
  const stableLabelOrder = useMemo(() => {
    const labels = new Set<string>();
    for (const a of athletes) {
      const g =
        dim === "team"
          ? a.team_id
            ? teamNameById.get(a.team_id)
            : null
          : dim === "position"
            ? a.position
            : dim === "grade"
              ? a.grade != null
                ? `Grade ${a.grade}`
                : null
              : a.sport;
      if (g) labels.add(g);
    }
    return Array.from(labels).sort();
  }, [athletes, dim, teamNameById]);

  const colorFor = (label: string) => {
    const idx = stableLabelOrder.indexOf(label);
    return SERIES_VARS[(idx < 0 ? 0 : idx) % MAX_SERIES];
  };

  const report = useMemo(() => {
    if (!metric) return null;
    return groupedTrend(
      metric,
      pool.map((a) => a.id),
      tests,
      repMaxes,
      groupOf,
      bucket,
    );
  }, [metric, pool, tests, repMaxes, groupOf, bucket]);

  const rangeN = Number(range);
  const periods = useMemo(() => (report ? report.periods.slice(-rangeN) : []), [report, rangeN]);
  const series = useMemo(() => {
    if (!report) return [];
    const shown = report.series.slice(0, MAX_SERIES);
    return shown.map((s) => ({ ...s, points: s.points.slice(-rangeN) }));
  }, [report, rangeN]);
  const overflow = report ? Math.max(0, report.series.length - MAX_SERIES) : 0;

  const chartRows = useMemo(() => {
    return periods.map((p, i) => {
      const row: Record<string, number | string | null> = {
        period: bucket === "month" ? p : p.slice(5),
      };
      for (const s of series) row[s.key] = s.points[i]?.value ?? null;
      return row;
    });
  }, [periods, series, bucket]);

  const standings = useMemo(() => {
    return series
      .map((s) => {
        const withData = s.points.filter((p) => p.value != null);
        const last = withData[withData.length - 1]?.value ?? null;
        const first = withData[0]?.value ?? null;
        const delta =
          last != null && first != null
            ? metric?.lowerIsBetter
              ? first - last
              : last - first
            : null;
        return { key: s.key, label: s.label, last, delta };
      })
      .filter((s) => s.last != null)
      .sort((a, b) => (metric?.lowerIsBetter ? a.last! - b.last! : b.last! - a.last!));
  }, [series, metric]);

  return (
    <Card className="overflow-hidden border-border/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Group Trend Report</CardTitle>
            <p className="text-xs text-muted-foreground">
              How each group is trending over time, not just where it stands today.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={dim}
              onValueChange={(v) => {
                setDim(v as GroupDim);
                setTeamFilter("all");
              }}
            >
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIM_OPTIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    Group by {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {dim !== "team" && (
              <Select value={teamFilter} onValueChange={setTeamFilter}>
                <SelectTrigger className="h-8 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All teams</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={metricKey || (allMetrics[0]?.key ?? "")} onValueChange={setMetricKey}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Metric" />
              </SelectTrigger>
              <SelectContent>
                {allMetrics.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={bucket} onValueChange={(v) => setBucket(v as TrendBucket)}>
              <SelectTrigger className="h-8 w-[100px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Weekly</SelectItem>
                <SelectItem value="month">Monthly</SelectItem>
              </SelectContent>
            </Select>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="h-8 w-[110px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!metric || series.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No data yet for this metric and grouping.
          </p>
        ) : (
          <>
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={{ top: 4, right: 16, left: -8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    domain={["auto", "auto"]}
                    reversed={metric.lowerIsBetter}
                    unit={metric.unit ? ` ${metric.unit}` : undefined}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      fontSize: 12,
                    }}
                    formatter={(v: number, name: string) => {
                      const s = series.find((x) => x.key === name);
                      return [
                        v == null
                          ? "—"
                          : `${v.toFixed(metric.unit === "lb" ? 0 : 2)} ${metric.unit}`,
                        s?.label ?? name,
                      ];
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value: string) =>
                      series.find((x) => x.key === value)?.label ?? value
                    }
                  />
                  {series.map((s) => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.key}
                      stroke={colorFor(s.label)}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {overflow > 0 && (
              <p className="text-[11px] text-muted-foreground">
                +{overflow} more group{overflow === 1 ? "" : "s"} not plotted (top {MAX_SERIES}{" "}
                shown) — see the table below for the full list.
              </p>
            )}

            <div className="overflow-x-auto rounded-md border border-border/60">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Group</th>
                    <th className="px-3 py-2 font-semibold">Latest avg</th>
                    <th className="px-3 py-2 font-semibold">Change over range</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {standings.map((s) => {
                    const TrendIcon =
                      s.delta == null || Math.abs(s.delta) < 1e-9
                        ? Minus
                        : s.delta > 0
                          ? ArrowUp
                          : ArrowDown;
                    const positive = s.delta != null && s.delta > 1e-9;
                    const negative = s.delta != null && s.delta < -1e-9;
                    return (
                      <tr key={s.key}>
                        <td className="px-3 py-2 font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ background: colorFor(s.label) }}
                            />
                            {s.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {s.last?.toFixed(metric.unit === "lb" ? 0 : 2)} {metric.unit}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center gap-1 tabular-nums ${
                              positive
                                ? "text-[color:var(--status-pr)]"
                                : negative
                                  ? "text-[color:var(--status-below)]"
                                  : "text-muted-foreground"
                            }`}
                          >
                            <TrendIcon className="h-3 w-3" />
                            {s.delta == null
                              ? "—"
                              : `${s.delta > 0 ? "+" : ""}${s.delta.toFixed(metric.unit === "lb" ? 0 : 2)} ${metric.unit}`}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
