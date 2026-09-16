// Arketype-style "Team Daily Metric Analysis": athletes (rows) x test dates
// (columns) for one selected metric, shaded relative to each athlete's own
// career average so the table reads "who's trending up/down", not just raw
// numbers. Filterable by team, position, and metric (PRs or weekly tests).
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users, Trophy, Award, TrendingUp } from "lucide-react";
import {
  athleteDisplayName,
  type Athlete,
  type TestRow,
  type RepMax,
  type CustomTestType,
  type Team,
} from "@/lib/queries";
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

const MAX_COLUMNS = 8;

export function TeamMetricReport({
  athletes,
  tests,
  repMaxes,
  customTypes,
  teams,
  defaultTeamId,
}: {
  athletes: Athlete[];
  tests: TestRow[];
  repMaxes: RepMax[];
  customTypes: CustomTestType[];
  teams: Team[];
  defaultTeamId?: string | null;
}) {
  const allMetrics = useMemo(
    () => allReportMetrics(customTypes, repMaxes),
    [customTypes, repMaxes],
  );

  const [teamId, setTeamId] = useState<string>(defaultTeamId ?? "all");
  const [position, setPosition] = useState<string>("all");
  const [metricKey, setMetricKey] = useState<string>("");
  const [win, setWin] = useState<ReportWindow>("season");

  useEffect(() => {
    if (!metricKey && allMetrics.length) setMetricKey(allMetrics[0].key);
  }, [allMetrics, metricKey]);

  const metric = allMetrics.find((m) => m.key === metricKey) ?? allMetrics[0] ?? null;

  const pool = useMemo(() => {
    return athletes.filter((a) => {
      if (teamId !== "all" && a.team_id !== teamId) return false;
      if (position !== "all" && (a.position ?? "") !== position) return false;
      return true;
    });
  }, [athletes, teamId, position]);

  const positions = useMemo(
    () => Array.from(new Set(pool.map((a) => a.position).filter((p): p is string => !!p))).sort(),
    [pool],
  );

  const rows = useMemo(() => {
    if (!metric) return [];
    return pool
      .map((a) => {
        const full = reportSeries(metric, a.id, tests, repMaxes);
        const flagged = withPRFlags(full, metric.lowerIsBetter);
        const points = filterByWindow(flagged, win);
        return { athlete: a, points, avg: average(full) };
      })
      .filter((r) => r.points.length > 0)
      .sort((a, b) => {
        const av = a.points[a.points.length - 1].value;
        const bv = b.points[b.points.length - 1].value;
        return metric.lowerIsBetter ? av - bv : bv - av;
      });
  }, [pool, metric, tests, repMaxes, win]);

  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const p of r.points) set.add(p.date);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, MAX_COLUMNS)
      .reverse();
  }, [rows]);

  const summary = useMemo(() => {
    if (!metric || rows.length === 0) return null;
    const latestVals = rows.map((r) => r.points[r.points.length - 1].value);
    const teamAvg = latestVals.reduce((s, v) => s + v, 0) / latestVals.length;
    const top = rows[0];
    const improved = rows
      .filter((r) => r.points.length >= 2)
      .map((r) => {
        const first = r.points[0].value;
        const last = r.points[r.points.length - 1].value;
        const diff = metric.lowerIsBetter ? first - last : last - first;
        return { athlete: r.athlete, pct: diff / (Math.abs(first) || 1) };
      })
      .sort((a, b) => b.pct - a.pct);
    const mostImproved = improved[0]?.pct > 0 ? improved[0] : null;
    return { teamAvg, top, mostImproved, tested: rows.length, total: pool.length };
  }, [rows, metric, pool.length]);

  return (
    <Card className="overflow-hidden border-border/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Team Dashboard</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={teamId}
              onValueChange={(v) => {
                setTeamId(v);
                setPosition("all");
              }}
            >
              <SelectTrigger className="h-8 w-[140px] text-xs">
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
            {positions.length > 0 && (
              <Select value={position} onValueChange={setPosition}>
                <SelectTrigger className="h-8 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All positions</SelectItem>
                  {positions.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={metricKey} onValueChange={setMetricKey}>
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
            <Select value={win} onValueChange={(v) => setWin(v as ReportWindow)}>
              <SelectTrigger className="h-8 w-[110px] text-xs">
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
        {summary && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryTile
              icon={<Users className="h-3.5 w-3.5" />}
              label="Tested"
              value={`${summary.tested}/${summary.total}`}
            />
            <SummaryTile
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              label="Team avg"
              value={`${summary.teamAvg.toFixed(1)} ${metric?.unit ?? ""}`}
            />
            <SummaryTile
              icon={<Trophy className="h-3.5 w-3.5" />}
              label="Top performer"
              value={summary.top ? athleteDisplayName(summary.top.athlete) : "—"}
            />
            <SummaryTile
              icon={<Award className="h-3.5 w-3.5" />}
              label="Most improved"
              value={
                summary.mostImproved
                  ? `${athleteDisplayName(summary.mostImproved.athlete)} +${(summary.mostImproved.pct * 100).toFixed(1)}%`
                  : "—"
              }
            />
          </div>
        )}

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No data logged for this metric yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left font-semibold text-muted-foreground">
                    Athlete
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
                  <tr key={r.athlete.id}>
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-2 font-medium">
                      {athleteDisplayName(r.athlete)}
                    </td>
                    {dates.map((d) => {
                      const p = r.points.find((pt) => pt.date === d);
                      const tone = cellTone(
                        p?.value ?? null,
                        r.avg,
                        metric?.lowerIsBetter ?? false,
                        p?.isPR,
                      );
                      return (
                        <td
                          key={d}
                          className={`px-2 py-2 text-center tabular-nums ${CELL_TONE_CLASS[tone]}`}
                        >
                          {p ? p.value.toFixed(metric?.unit === "lb" ? 0 : 2) : "—"}
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
          <Legend tone="up" label="Above own avg" />
          <Legend tone="down" label="Below own avg" />
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
      <div className="stat-number mt-0.5 truncate text-sm">{value}</div>
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
