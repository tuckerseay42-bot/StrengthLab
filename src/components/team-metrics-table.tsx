// The coach's primary report: every athlete down the rows, filterable by
// sport/gender/class/team/position, with an Athlete Average and Best
// column (each athlete's own numbers) followed by one column per date the
// metric was tested, and a Team Average footer row per date for group
// comparison — a real spreadsheet, not a chart.
import { useEffect, useMemo, useState } from "react";
import { Flame } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  athleteDisplayName,
  type Athlete,
  type TestRow,
  type LiftRow,
  type RepMax,
  type CustomTestType,
  type CustomMetric,
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

const DATE_RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "7", label: "Week" },
  { value: "30", label: "Month" },
  { value: "90", label: "3 Months" },
  { value: "180", label: "6 Months" },
  { value: "365", label: "Year" },
];

/** Filters a sorted list of ISO dates down to a calendar window ending today. */
function filterDatesByRange(all: string[], range: string): string[] {
  if (range === "today") {
    const today = new Date().toISOString().slice(0, 10);
    return all.filter((d) => d === today);
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(range));
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  return all.filter((d) => d >= cutoffISO);
}

export function TeamMetricsTable({
  athletes,
  tests,
  repMaxes,
  lifts,
  customTypes,
  customMetrics,
  teams,
}: {
  athletes: Athlete[];
  tests: TestRow[];
  repMaxes: RepMax[];
  lifts: LiftRow[];
  customTypes: CustomTestType[];
  customMetrics: CustomMetric[];
  teams: Team[];
}) {
  const allMetrics = useMemo(
    () => allReportMetrics(customTypes, repMaxes, lifts, customMetrics),
    [customTypes, repMaxes, lifts, customMetrics],
  );
  const metricGroups = useMemo(() => {
    const order = ["Speed", "Jumps", "Strength", "Lifts", "Custom Metrics", "PRs (est. 1RM)"];
    const groups = Array.from(new Set(allMetrics.map((m) => m.group)));
    return groups.sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [allMetrics]);
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
  const [dateRange, setDateRange] = useState("30");
  const [tableDateRange, setTableDateRange] = useState("30");

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
        reportSeries(metric, a.id, tests, repMaxes, lifts, customMetrics, a.bodyweight),
        metric.lowerIsBetter,
      );
      const values = flagged.map((p) => p.value);
      const best = values.length
        ? metric.lowerIsBetter
          ? Math.min(...values)
          : Math.max(...values)
        : null;
      return { athlete: a, points: flagged, best, avg: average(flagged) };
    });
  }, [pool, metric, tests, repMaxes, lifts, customMetrics]);

  const allDatesLogged = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const p of r.points) set.add(p.date);
    return Array.from(set).sort();
  }, [rows]);

  // The PR/Avg increase strip and the table's own date columns are windowed
  // independently — a coach might want "PRs this week" next to "the whole
  // season" of data, or vice versa.
  const prDates = useMemo(
    () => filterDatesByRange(allDatesLogged, dateRange),
    [allDatesLogged, dateRange],
  );
  const dates = useMemo(
    () => filterDatesByRange(allDatesLogged, tableDateRange),
    [allDatesLogged, tableDateRange],
  );

  const rowsWithData = rows.filter((r) => r.points.length > 0);

  // PR count + average improvement, scoped to the selected metric, filters,
  // and PR window (prDates) — not career-wide.
  const prStats = useMemo(() => {
    const dateSet = new Set(prDates);
    const prPoints = rowsWithData.flatMap((r) => r.points.filter((p) => p.isPR && dateSet.has(p.date)));
    const deltas = prPoints.map((p) => p.delta).filter((d): d is number => d != null);
    return {
      count: prPoints.length,
      avgIncrease: deltas.length ? deltas.reduce((s, d) => s + d, 0) / deltas.length : null,
    };
  }, [rowsWithData, prDates]);

  const dateAverages = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of dates) {
      const values = rowsWithData
        .map((r) => r.points.find((p) => p.date === d)?.value)
        .filter((v): v is number => v != null);
      if (values.length) m.set(d, values.reduce((s, v) => s + v, 0) / values.length);
    }
    return m;
  }, [dates, rowsWithData]);

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
                {metricGroups.map((g) => (
                  <SelectGroup key={g}>
                    <SelectLabel className="text-[10px] uppercase tracking-wider">{g}</SelectLabel>
                    {allMetrics.filter((m) => m.group === g).map((m) => (
                      <SelectItem key={m.key} value={m.key}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                PR window
              </span>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="h-8 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_RANGE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {metric && (
          <div className="mt-2 flex flex-wrap items-center gap-4 rounded-md border border-[color:var(--status-pr)]/25 bg-[color:var(--status-pr)]/5 px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <Flame className="h-3.5 w-3.5 text-[color:var(--status-pr)]" /> {metric.label}
            </span>
            <span className="text-muted-foreground">
              <span className="mono-number text-sm font-bold text-foreground">{prStats.count}</span> PR{prStats.count === 1 ? "" : "s"}
            </span>
            <span className="text-muted-foreground">
              Avg increase{" "}
              <span className="mono-number text-sm font-bold text-[color:var(--status-pr)]">
                {prStats.avgIncrease == null
                  ? "—"
                  : `${metric.lowerIsBetter ? "-" : "+"}${prStats.avgIncrease.toFixed(metric.unit === "lb" ? 0 : 2)} ${metric.unit}`}
              </span>
            </span>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Table window
            </span>
            <Select value={tableDateRange} onValueChange={setTableDateRange}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
                    Athlete Average
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                    Best
                    <span className="block text-[9px] font-normal normal-case text-muted-foreground/70">
                      (athlete's own)
                    </span>
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
                      {r.avg == null
                        ? "—"
                        : `${r.avg.toFixed(metric.unit === "lb" ? 0 : 2)} ${metric.unit}`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-center tabular-nums font-semibold text-[color:var(--status-pr)]">
                      {r.best == null
                        ? "—"
                        : `${r.best.toFixed(metric.unit === "lb" ? 0 : 2)} ${metric.unit}`}
                    </td>
                    {dates.map((d) => {
                      const p = r.points.find((pt) => pt.date === d);
                      const tone = cellTone(
                        p?.value ?? null,
                        dateAverages.get(d) ?? null,
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
              <tfoot>
                <tr className="border-t-2 border-border/60 bg-muted/30 font-semibold">
                  <td className="sticky left-0 z-10 bg-muted/30 px-3 py-2">Team Average</td>
                  <td className="px-3 py-2 text-center text-muted-foreground">—</td>
                  <td className="px-3 py-2 text-center text-muted-foreground">—</td>
                  {dates.map((d) => {
                    const v = dateAverages.get(d);
                    return (
                      <td key={d} className="px-2 py-2 text-center tabular-nums">
                        {v == null ? "—" : v.toFixed(metric.unit === "lb" ? 0 : 2)}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
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
