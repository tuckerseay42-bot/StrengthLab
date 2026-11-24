// The Performance "Team Metrics Table", laid out like the Weigh-In table: every
// athlete down the side, one column per day somebody was tested (newest on the
// left). Each box is the athlete's best result that day with the change from their
// own previous test. The group row compares only athletes tested on both days.
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Flame, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  weighInsQO,
  type Athlete,
  type TestRow,
  type LiftRow,
  type RepMax,
  type CustomTestType,
  type CustomMetric,
  type Team,
  type WeighInRow,
} from "@/lib/queries";
import { SPORTS, GENDERS, GENDER_LABELS, GRADES } from "@/lib/domain";
import {
  allReportMetrics,
  reportSeries,
  withPRFlags,
  average,
  type ReportMetric,
} from "@/lib/dashboard-report-metrics";
import {
  buildMetricGrid,
  formatDelta,
  formatValue,
  GRID_RANGES,
  latestImprovement,
  visibleDates,
  type GridCell,
  type GroupDay,
} from "@/lib/metric-grid";
import { easternToday } from "@/lib/weigh-ins";
import { cn } from "@/lib/utils";

const NO_WEIGH_INS: WeighInRow[] = [];
const DAY_COUNTS = ["6", "8", "12", "20", "all"] as const;

type SortKey = "name" | "best" | "improved" | "stale";

function shortDate(date: string, thisYear: string) {
  const text = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return date.slice(0, 4) === thisYear ? text : `${text} '${date.slice(2, 4)}`;
}

function changeClass(better: boolean | null) {
  if (better === true) return "text-emerald-500";
  if (better === false) return "text-red-500";
  return "text-muted-foreground";
}

function DayCell({ cell, unit }: { cell: GridCell | undefined; unit: string }) {
  if (!cell) return <span className="text-muted-foreground/50">—</span>;
  return (
    <div className="leading-tight">
      <div className="font-bold tabular-nums">{formatValue(cell.value, unit)}</div>
      {cell.change != null && (
        <div className={cn("text-[10px] font-semibold tabular-nums", changeClass(cell.better))}>
          {formatDelta(cell.change, unit)}
        </div>
      )}
    </div>
  );
}

function GroupDayCell({
  g,
  unit,
  lowerIsBetter,
  total,
}: {
  g: GroupDay | undefined;
  unit: string;
  lowerIsBetter: boolean;
  total: number;
}) {
  if (!g) return <span className="text-muted-foreground/50">—</span>;
  const better =
    g.change == null || g.change === 0 ? null : lowerIsBetter ? g.change < 0 : g.change > 0;
  return (
    <div className="leading-tight">
      <div className="text-base font-extrabold tabular-nums">{formatValue(g.avg, unit)}</div>
      {g.change != null && (
        <div className={cn("text-[11px] font-semibold tabular-nums", changeClass(better))}>
          {formatDelta(g.change, unit)}
        </div>
      )}
      <div className="text-[10px] font-normal text-muted-foreground">
        {g.tested} of {total} tested
      </div>
    </div>
  );
}

export function MetricDayGrid({
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
  const { data: weighInData } = useQuery(weighInsQO);
  const weighIns = weighInData ?? NO_WEIGH_INS;
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
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [dayCount, setDayCount] = useState<(typeof DAY_COUNTS)[number]>("8");
  const [range, setRange] = useState("all");
  const [prRange, setPrRange] = useState("30");

  const positions = useMemo(
    () =>
      Array.from(new Set(athletes.map((a) => a.position).filter((p): p is string => !!p))).sort(),
    [athletes],
  );

  const pool = useMemo(() => {
    const q = search.trim().toLowerCase();
    return athletes.filter((a) => {
      if (teamId !== "all" && a.team_id !== teamId) return false;
      if (position !== "all" && (a.position ?? "") !== position) return false;
      if (sport !== "all" && (a.sport ?? "").toLowerCase() !== sport.toLowerCase()) return false;
      if (gender !== "all" && (a.gender ?? "") !== gender) return false;
      if (grade !== "all" && String(a.grade ?? "") !== grade) return false;
      if (q && !athleteDisplayName(a).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [athletes, teamId, position, sport, gender, grade, search]);

  const unit = metric?.unit ?? "";
  const lowerIsBetter = metric?.lowerIsBetter ?? false;

  // Each athlete's best result per day (the report engine already keeps the best of a day).
  const seriesByAthlete = useMemo(() => {
    const m = new Map<string, ReturnType<typeof reportSeries>>();
    if (!metric) return m;
    for (const a of pool) {
      m.set(
        a.id,
        reportSeries(metric, a.id, tests, repMaxes, lifts, customMetrics, a.bodyweight, weighIns),
      );
    }
    return m;
  }, [pool, metric, tests, repMaxes, lifts, customMetrics, weighIns]);

  const grid = useMemo(
    () =>
      buildMetricGrid(
        pool.map((a) => ({ id: a.id, points: seriesByAthlete.get(a.id) ?? [] })),
        lowerIsBetter,
        unit,
      ),
    [pool, seriesByAthlete, lowerIsBetter, unit],
  );

  const today = easternToday();
  const thisYear = today.slice(0, 4);
  const dates = useMemo(
    () => visibleDates(grid.datesAsc, range, dayCount === "all" ? null : Number(dayCount), today),
    [grid.datesAsc, range, dayCount, today],
  );

  const rows = useMemo(() => {
    const list = pool.map((athlete) => {
      const series = seriesByAthlete.get(athlete.id) ?? [];
      const values = series.map((p) => p.value);
      const best = values.length
        ? lowerIsBetter
          ? Math.min(...values)
          : Math.max(...values)
        : null;
      return {
        athlete,
        series,
        best,
        avg: average(series),
        cells: grid.cells.get(athlete.id),
        lastDate: series.length ? series[series.length - 1].date : null,
      };
    });
    const byName = (a: (typeof list)[number], b: (typeof list)[number]) =>
      athleteDisplayName(a.athlete).localeCompare(athleteDisplayName(b.athlete));
    if (sort === "name") return list.sort(byName);
    if (sort === "best") {
      return list.sort((a, b) => {
        if (a.best == null && b.best == null) return byName(a, b);
        if (a.best == null) return 1;
        if (b.best == null) return -1;
        return (lowerIsBetter ? a.best - b.best : b.best - a.best) || byName(a, b);
      });
    }
    if (sort === "improved") {
      return list.sort((a, b) => {
        const ai = latestImprovement(a.cells, lowerIsBetter);
        const bi = latestImprovement(b.cells, lowerIsBetter);
        if (ai == null && bi == null) return byName(a, b);
        if (ai == null) return 1;
        if (bi == null) return -1;
        return bi - ai || byName(a, b);
      });
    }
    // Longest since tested first; never tested at the very top.
    return list.sort((a, b) => {
      if (a.lastDate == null && b.lastDate == null) return byName(a, b);
      if (a.lastDate == null) return -1;
      if (b.lastDate == null) return 1;
      return a.lastDate.localeCompare(b.lastDate) || byName(a, b);
    });
  }, [pool, seriesByAthlete, grid, sort, lowerIsBetter]);

  const testedCount = rows.filter((r) => r.series.length > 0).length;

  // PR count + average improvement for the chosen metric, filters and PR window.
  const prStats = useMemo(() => {
    const prDates = new Set(visibleDates(grid.datesAsc, prRange, null, today));
    const points = pool.flatMap((a) =>
      withPRFlags(seriesByAthlete.get(a.id) ?? [], lowerIsBetter).filter(
        (p) => p.isPR && prDates.has(p.date),
      ),
    );
    const deltas = points.map((p) => p.delta).filter((d): d is number => d != null);
    return {
      count: points.length,
      avgIncrease: deltas.length ? deltas.reduce((s, d) => s + d, 0) / deltas.length : null,
    };
  }, [pool, seriesByAthlete, grid.datesAsc, prRange, lowerIsBetter, today]);

  const rangeLabel = GRID_RANGES.find((o) => o.value === range)?.label ?? range;
  const printSummary = [
    metric ? metric.label : null,
    `${dayCount === "all" ? "All" : `Last ${dayCount}`} test days · ${rangeLabel}`,
    teamId !== "all" ? `Team: ${teams.find((t) => t.id === teamId)?.name ?? teamId}` : null,
    position !== "all" ? `Position: ${position}` : null,
    sport !== "all" ? `Sport: ${sport}` : null,
    gender !== "all"
      ? `Gender: ${GENDER_LABELS[gender as keyof typeof GENDER_LABELS] ?? gender}`
      : null,
    grade !== "all" ? `Grade ${grade}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const th =
    "px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <Card className="print-sheet overflow-hidden border-border/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Team Metrics Table</CardTitle>
            <p className="text-xs text-muted-foreground print:hidden">
              Every athlete, one metric, one column for each day it was tested. Newest is on the
              left.
            </p>
            <p className="hidden text-xs text-muted-foreground print:block">{printSummary}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => window.print()}
            >
              <Printer className="mr-1.5 h-3.5 w-3.5" /> Print
            </Button>
            <Select value={metricKey || (allMetrics[0]?.key ?? "")} onValueChange={setMetricKey}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Metric" />
              </SelectTrigger>
              <SelectContent>
                {metricGroups.map((g) => (
                  <SelectGroup key={g}>
                    <SelectLabel className="text-[10px] uppercase tracking-wider">{g}</SelectLabel>
                    {allMetrics
                      .filter((m) => m.group === g)
                      .map((m) => (
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
              <Select value={prRange} onValueChange={setPrRange}>
                <SelectTrigger className="h-8 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRID_RANGES.map((o) => (
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
              <span className="mono-number text-sm font-bold text-foreground">{prStats.count}</span>{" "}
              PR{prStats.count === 1 ? "" : "s"}
            </span>
            <span className="text-muted-foreground">
              Avg improvement{" "}
              <span className="mono-number text-sm font-bold text-[color:var(--status-pr)]">
                {prStats.avgIncrease == null
                  ? "—"
                  : `${lowerIsBetter ? "-" : "+"}${formatValue(prStats.avgIncrease, unit)} ${unit}`}
              </span>
            </span>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5 print:hidden">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search athlete…"
            className="h-8 w-40 text-xs"
          />
          <Select value={dayCount} onValueChange={(v) => setDayCount(v as typeof dayCount)}>
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAY_COUNTS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c === "all" ? "All test days" : `Last ${c} test days`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRID_RANGES.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-8 w-[170px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Sort: name</SelectItem>
              <SelectItem value="best">Sort: best result</SelectItem>
              <SelectItem value="improved">Sort: most improved</SelectItem>
              <SelectItem value="stale">Sort: longest since tested</SelectItem>
            </SelectContent>
          </Select>
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
        {!metric ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No metrics to show yet.</p>
        ) : !rows.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No athletes match these filters.
          </p>
        ) : testedCount === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No results logged yet for this metric and filter set.
          </p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                {rows.length} athletes · {testedCount} with results
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <b className="text-foreground">28.5</b> best that day
                </span>
                <span>— not tested</span>
                <span className="text-emerald-500">better than last test</span>
                <span className="text-red-500">worse than last test</span>
              </span>
            </div>
            <div className="overflow-x-auto rounded-md border border-border/60">
              <table className="w-full min-w-max border-collapse text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Athlete
                    </th>
                    <th className={th}>Average</th>
                    <th className={th}>Best</th>
                    {dates.map((d, i) => (
                      <th key={d} className={cn(th, i === 0 && "text-foreground")}>
                        {shortDate(d, thisYear)}
                        {i === 0 && (
                          <div className="text-[9px] font-normal normal-case tracking-normal">
                            latest
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b-2 border-primary/40 bg-primary/10">
                    <td className="sticky left-0 z-10 bg-[color-mix(in_oklab,var(--background)_88%,var(--primary))] px-3 py-2">
                      <div className="text-sm font-extrabold uppercase tracking-wide">
                        Group average
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {rows.length} athlete{rows.length === 1 ? "" : "s"} shown
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center text-muted-foreground/50">—</td>
                    <td className="px-2 py-2 text-center text-muted-foreground/50">—</td>
                    {dates.map((d) => (
                      <td key={d} className="px-2 py-2 text-center">
                        <GroupDayCell
                          g={grid.group.get(d)}
                          unit={unit}
                          lowerIsBetter={lowerIsBetter}
                          total={rows.length}
                        />
                      </td>
                    ))}
                  </tr>
                  {rows.map((r) => (
                    <tr key={r.athlete.id} className="border-t border-border/50 hover:bg-muted/20">
                      <td className="sticky left-0 z-10 bg-background px-3 py-1.5">
                        <Link
                          to="/athletes/$id"
                          params={{ id: r.athlete.id }}
                          className="font-medium hover:text-primary"
                        >
                          {athleteDisplayName(r.athlete)}
                        </Link>
                        <div className="text-[10px] text-muted-foreground">
                          {[
                            r.athlete.grade ? `G${r.athlete.grade}` : null,
                            r.athlete.position,
                            r.athlete.sport,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-center tabular-nums text-muted-foreground">
                        {r.avg == null ? "—" : formatValue(r.avg, unit)}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-2 py-1.5 text-center font-semibold tabular-nums",
                          r.best == null
                            ? "text-muted-foreground/50"
                            : "text-[color:var(--status-pr)]",
                        )}
                      >
                        {r.best == null ? "—" : formatValue(r.best, unit)}
                      </td>
                      {dates.map((d) => (
                        <td key={d} className="px-2 py-1.5 text-center">
                          <DayCell cell={r.cells?.get(d)} unit={unit} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Only days when someone was tested get a column, newest on the left. A box shows the
              athlete's best result that day and the change from their own previous test. The group
              change compares only the athletes tested on both days (it needs at least 3). Average
              and Best use all of an athlete's tests, not just the days shown. Faster is better for
              timed tests.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
