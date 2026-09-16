// The coach's primary report: every athlete down the rows, filterable by
// sport/gender/class/team/position, with a Team Avg and Best reference
// column so each athlete's numbers read against the group, followed by one
// column per date the metric was tested — a real spreadsheet, not a chart.
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  athleteDisplayName,
  type Athlete,
  type TestRow,
  type RepMax,
  type CustomTestType,
  type Team,
} from "@/lib/queries";
import { SPORTS, GENDERS, GENDER_LABELS, GRADES } from "@/lib/domain";
import {
  allReportMetrics,
  reportSeries,
  withPRFlags,
  average,
  cellTone,
  CELL_TONE_CLASS,
  type ReportMetric,
} from "@/lib/dashboard-report-metrics";

const DATE_COUNT_OPTIONS = [
  { value: "6", label: "Last 6 dates" },
  { value: "10", label: "Last 10 dates" },
  { value: "16", label: "Last 16 dates" },
  { value: "999", label: "All dates" },
];

export function TeamMetricsTable({
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
  const [metricKey, setMetricKey] = useState("");
  useEffect(() => {
    if (!metricKey && allMetrics.length) setMetricKey(allMetrics[0].key);
  }, [allMetrics, metricKey]);
  const metric: ReportMetric | null =
    allMetrics.find((m) => m.key === metricKey) ?? allMetrics[0] ?? null;

  const [teamId, setTeamId] = useState("all");
  const [position, setPosition] = useState("all");
  const [sport, setSport] = useState("all");
  const [gender, setGender] = useState("all");
  const [grade, setGrade] = useState("all");
  const [dateCount, setDateCount] = useState("10");

  const positions = useMemo(
    () =>
      Array.from(new Set(athletes.map((a) => a.position).filter((p): p is string => !!p))).sort(),
    [athletes],
  );

  const pool = useMemo(() => {
    return athletes.filter((a) => {
      if (teamId !== "all" && a.team_id !== teamId) return false;
      if (position !== "all" && (a.position ?? "") !== position) return false;
      if (sport !== "all" && (a.sport ?? "").toLowerCase() !== sport.toLowerCase()) return false;
      if (gender !== "all" && (a.gender ?? "") !== gender) return false;
      if (grade !== "all" && String(a.grade ?? "") !== grade) return false;
      return true;
    });
  }, [athletes, teamId, position, sport, gender, grade]);

  const rows = useMemo(() => {
    if (!metric) return [];
    return pool.map((a) => {
      const flagged = withPRFlags(
        reportSeries(metric, a.id, tests, repMaxes),
        metric.lowerIsBetter,
      );
      return { athlete: a, points: flagged };
    });
  }, [pool, metric, tests, repMaxes]);

  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const p of r.points) set.add(p.date);
    const all = Array.from(set).sort();
    const n = Number(dateCount);
    return all.length > n ? all.slice(-n) : all;
  }, [rows, dateCount]);

  const { teamAvg, teamBest } = useMemo(() => {
    if (!metric) return { teamAvg: null as number | null, teamBest: null as number | null };
    const bests = rows.map((r) => average(r.points)).filter((v): v is number => v != null);
    if (!bests.length) return { teamAvg: null, teamBest: null };
    const avg = bests.reduce((s, v) => s + v, 0) / bests.length;
    const allValues = rows.flatMap((r) => r.points.map((p) => p.value));
    const best = allValues.length
      ? metric.lowerIsBetter
        ? Math.min(...allValues)
        : Math.max(...allValues)
      : null;
    return { teamAvg: avg, teamBest: best };
  }, [rows, metric]);

  const rowsWithData = rows.filter((r) => r.points.length > 0);

  return (
    <Card className="overflow-hidden border-border/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Team Metrics Table</CardTitle>
            <p className="text-xs text-muted-foreground">
              Every athlete, one metric, tested-date by tested-date, against the team.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <Select value={dateCount} onValueChange={setDateCount}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_COUNT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select
            value={teamId}
            onValueChange={(v) => {
              setTeamId(v);
              setPosition("all");
            }}
          >
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
          <Select value={position} onValueChange={setPosition}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="Position" />
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
          <Select value={sport} onValueChange={setSport}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="Sport" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sports</SelectItem>
              {SPORTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={gender} onValueChange={setGender}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="Gender" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All genders</SelectItem>
              {GENDERS.map((g) => (
                <SelectItem key={g} value={g}>
                  {GENDER_LABELS[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={grade} onValueChange={setGrade}>
            <SelectTrigger className="h-8 w-[110px] text-xs">
              <SelectValue placeholder="Class" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {GRADES.map((g) => (
                <SelectItem key={g} value={String(g)}>
                  Grade {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {!metric || rowsWithData.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No results logged yet for this metric and filter set.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left font-semibold text-muted-foreground">
                    Athlete
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                    Team Avg
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                    Best
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
                {rowsWithData.map((r) => (
                  <tr key={r.athlete.id}>
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-2 font-medium">
                      {athleteDisplayName(r.athlete)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-center tabular-nums text-muted-foreground">
                      {teamAvg == null
                        ? "—"
                        : `${teamAvg.toFixed(metric.unit === "lb" ? 0 : 2)} ${metric.unit}`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-center tabular-nums font-semibold text-[color:var(--status-pr)]">
                      {teamBest == null
                        ? "—"
                        : `${teamBest.toFixed(metric.unit === "lb" ? 0 : 2)} ${metric.unit}`}
                    </td>
                    {dates.map((d) => {
                      const p = r.points.find((pt) => pt.date === d);
                      const tone = cellTone(
                        p?.value ?? null,
                        teamAvg,
                        metric.lowerIsBetter,
                        p?.isPR,
                      );
                      return (
                        <td
                          key={d}
                          className={`px-2 py-2 text-center tabular-nums ${CELL_TONE_CLASS[tone]}`}
                        >
                          {p ? p.value.toFixed(metric.unit === "lb" ? 0 : 2) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
          <Legend tone="pr" label="PR" />
          <Legend tone="up" label="Above team avg" />
          <Legend tone="down" label="Below team avg" />
          <Legend tone="flat" label="Near avg" />
        </div>
      </CardContent>
    </Card>
  );
}

function Legend({ tone, label }: { tone: "pr" | "up" | "down" | "flat"; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2.5 w-2.5 rounded-sm ${CELL_TONE_CLASS[tone]}`} />
      {label}
    </span>
  );
}
