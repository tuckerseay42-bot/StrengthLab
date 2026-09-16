// Arketype-style dense report for a single athlete: metrics (rows) x test
// dates (columns), shaded relative to the athlete's own career average with
// PRs called out. Replaces the spider graph + KPI card grid.
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trophy, Activity, CalendarClock, TrendingUp } from "lucide-react";
import type { Athlete, TestRow, RepMax, CustomTestType } from "@/lib/queries";
import {
  allReportMetrics,
  reportSeries,
  withPRFlags,
  average,
  filterByWindow,
  cellTone,
  CELL_TONE_CLASS,
  type ReportWindow,
  type CellTone,
} from "@/lib/report-metrics";

const MAX_COLUMNS = 10;

export function AthleteMetricReport({
  athlete,
  tests,
  repMaxes,
  customTypes,
}: {
  athlete: Athlete;
  tests: TestRow[];
  repMaxes: RepMax[];
  customTypes: CustomTestType[];
}) {
  const allMetrics = useMemo(
    () => allReportMetrics(customTypes, repMaxes),
    [customTypes, repMaxes],
  );
  const groups = useMemo(() => Array.from(new Set(allMetrics.map((m) => m.group))), [allMetrics]);

  const [group, setGroup] = useState<string>("all");
  const [win, setWin] = useState<ReportWindow>("season");

  const metrics = useMemo(
    () => (group === "all" ? allMetrics : allMetrics.filter((m) => m.group === group)),
    [allMetrics, group],
  );

  const rows = useMemo(() => {
    return metrics
      .map((m) => {
        const full = reportSeries(m, athlete.id, tests, repMaxes);
        const flagged = withPRFlags(full, m.lowerIsBetter);
        const windowed = filterByWindow(flagged, win);
        const points = windowed.length ? windowed : flagged.slice(-MAX_COLUMNS);
        return { metric: m, points, avg: average(full) };
      })
      .filter((r) => r.points.length > 0);
  }, [metrics, athlete.id, tests, repMaxes, win]);

  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const p of r.points) set.add(p.date);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, MAX_COLUMNS)
      .reverse();
  }, [rows]);

  const summary = useMemo(() => {
    const lastDate = rows.reduce<string | null>((max, r) => {
      const d = r.points[r.points.length - 1]?.date;
      return d && (!max || d > max) ? d : max;
    }, null);
    const prCount = rows.reduce((n, r) => n + r.points.filter((p) => p.isPR).length, 0);
    const improved = rows
      .filter((r) => r.points.length >= 2)
      .map((r) => {
        const first = r.points[0].value;
        const last = r.points[r.points.length - 1].value;
        const diff = r.metric.lowerIsBetter ? first - last : last - first;
        return diff / (Math.abs(first) || 1);
      });
    const avgImprovement = improved.length
      ? (improved.reduce((s, v) => s + v, 0) / improved.length) * 100
      : null;
    return { tracked: rows.length, prCount, lastDate, avgImprovement };
  }, [rows]);

  return (
    <Card className="overflow-hidden border-border/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Athlete Dashboard</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All metrics</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={win} onValueChange={(v) => setWin(v as ReportWindow)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30d">30 days</SelectItem>
                <SelectItem value="90d">90 days</SelectItem>
                <SelectItem value="season">Season</SelectItem>
                <SelectItem value="career">Career</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryTile
            icon={<Activity className="h-3.5 w-3.5" />}
            label="Metrics tracked"
            value={String(summary.tracked)}
          />
          <SummaryTile
            icon={<Trophy className="h-3.5 w-3.5" />}
            label="PRs in range"
            value={String(summary.prCount)}
          />
          <SummaryTile
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            label="Avg change"
            value={
              summary.avgImprovement == null
                ? "—"
                : `${summary.avgImprovement > 0 ? "+" : ""}${summary.avgImprovement.toFixed(1)}%`
            }
          />
          <SummaryTile
            icon={<CalendarClock className="h-3.5 w-3.5" />}
            label="Last tested"
            value={summary.lastDate ?? "—"}
          />
        </div>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No test or PR data logged yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left font-semibold text-muted-foreground">
                    Metric
                  </th>
                  {dates.map((d) => (
                    <th
                      key={d}
                      className="whitespace-nowrap px-2 py-2 text-center font-medium text-muted-foreground"
                    >
                      {d.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {rows.map((r) => (
                  <tr key={r.metric.key}>
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-2 font-medium">
                      {r.metric.label}
                      <span className="ml-1 text-[9px] uppercase text-muted-foreground">
                        {r.metric.unit}
                      </span>
                    </td>
                    {dates.map((d) => {
                      const p = r.points.find((pt) => pt.date === d);
                      const tone = cellTone(
                        p?.value ?? null,
                        r.avg,
                        r.metric.lowerIsBetter,
                        p?.isPR,
                      );
                      return (
                        <td
                          key={d}
                          className={`px-2 py-2 text-center tabular-nums ${CELL_TONE_CLASS[tone]}`}
                        >
                          {p ? p.value.toFixed(r.metric.unit === "lb" ? 0 : 2) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
          <Legend tone="pr" label="PR" />
          <Legend tone="up" label="Above avg" />
          <Legend tone="down" label="Below avg" />
          <Legend tone="flat" label="Near avg" />
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border/60 p-2.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="stat-number mt-0.5 text-lg">{value}</div>
    </div>
  );
}

function Legend({ tone, label }: { tone: CellTone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2.5 w-2.5 rounded-sm ${CELL_TONE_CLASS[tone]}`} />
      {label}
    </span>
  );
}
