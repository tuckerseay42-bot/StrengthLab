import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  athletesQO, testsQO, liftsQO, repMaxesQO, exercisesQO, teamsQO, testTypesQO,
  athleteDisplayName, type Athlete,
} from "@/lib/queries";
import { PageHeader, EmptyState } from "@/components/page-header";
import { PageSkeleton } from "@/components/loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Filters, emptyFilters, filterAthletes, type FilterState } from "@/components/filters";
import { TEST_TYPES, testTypeMeta as baseTestTypeMeta } from "@/lib/domain";
import { estimate1RM, ONE_RM_META } from "@/lib/one-rm";
import { useOrg1RMFormula } from "@/hooks/use-1rm-formula";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { cn } from "@/lib/utils";
import { ChevronDown, Dumbbell, AlertTriangle, Download } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RepMaxGrid } from "@/components/rep-max-grid";

export const Route = createFileRoute("/maxes")({
  head: () => ({
    meta: [
      { title: "Training Maxes & Rep Maxes — Strength Lab" },
      { name: "description", content: "See every athlete's rep maxes, estimated 1RMs and training maxes, and spot who is missing data for a lift or run." },
      { property: "og:title", content: "Training Maxes & Rep Maxes — Strength Lab" },
      { property: "og:description", content: "Rep maxes, estimated 1RMs, training maxes and data-coverage checks for your roster." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MaxesPage,
});

type MetricOpt = {
  key: string;
  label: string;
  group: string;
  kind: "lift" | "test";
  unit: string;
  lowerIsBetter: boolean;
  match?: string; // lowercased exercise name
  testType?: string;
};

type Cell = { value: number; sub?: string; date: string } | null;

function round5(n: number) {
  return Math.round(n / 5) * 5;
}

function MaxesPage() {
  const { data: athletes = [], isLoading } = useQuery(athletesQO);
  const { data: tests = [] } = useQuery(testsQO);
  const { data: lifts = [] } = useQuery(liftsQO);
  const { data: repMaxes = [] } = useQuery(repMaxesQO);
  const { data: exercises = [] } = useQuery(exercisesQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const formula = useOrg1RMFormula();
  const [activeTeamId] = useActiveTeamId();

  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [search, setSearch] = useState("");
  const [tmPct, setTmPct] = useState(90);
  const [missingOnly, setMissingOnly] = useState(false);
  const [selected, setSelected] = useState<string[] | null>(null);

  // ---- metric catalogue -------------------------------------------------
  const metricOptions = useMemo<MetricOpt[]>(() => {
    const out: MetricOpt[] = [];
    const seen = new Set<string>();

    const pushLift = (name: string, group: string) => {
      const key = `lift:${name.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ key, label: name, group, kind: "lift", unit: "lb", lowerIsBetter: false, match: name.toLowerCase() });
    };

    for (const e of exercises) {
      if (e.measurement_type && e.measurement_type !== "load") continue;
      pushLift(e.name, "Lifts");
    }
    for (const r of repMaxes) pushLift(r.exercise_name, "Lifts");
    for (const l of lifts) if (l.load != null) pushLift(l.exercise, "Lifts");

    const pushTest = (value: string, label: string, unit: string, lower: boolean, group: string) => {
      const key = `test:${value}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ key, label, group: group || "Tests", kind: "test", unit, lowerIsBetter: lower, testType: value });
    };
    for (const t of TEST_TYPES) pushTest(t.value, t.label, t.unit, t.lowerIsBetter, t.group);
    for (const c of customTypes) pushTest(c.value, c.label, c.unit, c.lower_is_better, c.group_name);
    for (const t of tests) {
      const m = baseTestTypeMeta(t.test_type);
      pushTest(t.test_type, m.label, m.unit, m.lowerIsBetter, m.group);
    }

    return out.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  }, [exercises, repMaxes, lifts, customTypes, tests]);

  // Default selection: the lifts/tests with the most data.
  const defaultSelected = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of repMaxes) counts.set(`lift:${r.exercise_name.toLowerCase()}`, (counts.get(`lift:${r.exercise_name.toLowerCase()}`) ?? 0) + 1);
    for (const l of lifts) if (l.load != null) counts.set(`lift:${l.exercise.toLowerCase()}`, (counts.get(`lift:${l.exercise.toLowerCase()}`) ?? 0) + 1);
    for (const t of tests) counts.set(`test:${t.test_type}`, (counts.get(`test:${t.test_type}`) ?? 0) + 1);
    return metricOptions
      .filter((m) => counts.has(m.key))
      .sort((a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0))
      .slice(0, 5)
      .map((m) => m.key);
  }, [metricOptions, repMaxes, lifts, tests]);

  const activeKeys = selected ?? defaultSelected;
  const activeMetrics = useMemo(
    () => activeKeys.map((k) => metricOptions.find((m) => m.key === k)).filter(Boolean) as MetricOpt[],
    [activeKeys, metricOptions],
  );

  const toggleMetric = (key: string) => {
    const cur = activeKeys;
    setSelected(cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
  };

  // ---- athletes ---------------------------------------------------------
  const roster = useMemo(() => {
    const base = filterAthletes(athletes, filters, activeTeamId);
    const q = search.trim().toLowerCase();
    const rows = q ? base.filter((a) => athleteDisplayName(a).toLowerCase().includes(q)) : base;
    return rows.sort((a, b) => athleteDisplayName(a).localeCompare(athleteDisplayName(b)));
  }, [athletes, filters, activeTeamId, search]);

  // ---- value lookup -----------------------------------------------------
  const bestLift = useMemo(() => {
    // athleteId → exercise(lower) → { e1rm, reps, load, date }
    const m = new Map<string, Map<string, { e1rm: number; reps: number; load: number; date: string }>>();
    const put = (aid: string, name: string, load: number, reps: number, date: string) => {
      const e1rm = estimate1RM(load, reps, formula) ?? load;
      let inner = m.get(aid);
      if (!inner) { inner = new Map(); m.set(aid, inner); }
      const key = name.toLowerCase();
      const cur = inner.get(key);
      if (!cur || e1rm > cur.e1rm) inner.set(key, { e1rm, reps, load, date });
    };
    for (const r of repMaxes) put(r.athlete_id, r.exercise_name, Number(r.load), r.reps, r.tested_at);
    for (const l of lifts) if (l.load != null) put(l.athlete_id, l.exercise, Number(l.load), l.reps ?? 1, l.lift_date);
    return m;
  }, [repMaxes, lifts, formula]);

  const bestTest = useMemo(() => {
    const m = new Map<string, Map<string, { value: number; date: string }>>();
    for (const t of tests) {
      const meta = metricOptions.find((o) => o.testType === t.test_type);
      const lower = meta?.lowerIsBetter ?? baseTestTypeMeta(t.test_type).lowerIsBetter;
      let inner = m.get(t.athlete_id);
      if (!inner) { inner = new Map(); m.set(t.athlete_id, inner); }
      const cur = inner.get(t.test_type);
      const better = !cur || (lower ? t.value < cur.value : t.value > cur.value);
      if (better) inner.set(t.test_type, { value: t.value, date: t.test_date });
    }
    return m;
  }, [tests, metricOptions]);

  const cellFor = (a: Athlete, m: MetricOpt): Cell => {
    if (m.kind === "lift") {
      const hit = bestLift.get(a.id)?.get(m.match!);
      if (!hit) return null;
      return { value: hit.e1rm, sub: `${hit.load}×${hit.reps}`, date: hit.date };
    }
    const hit = bestTest.get(a.id)?.get(m.testType!);
    if (!hit) return null;
    return { value: hit.value, date: hit.date };
  };

  const rows = useMemo(() => {
    const built = roster.map((a) => ({
      athlete: a,
      cells: activeMetrics.map((m) => cellFor(a, m)),
    }));
    return missingOnly ? built.filter((r) => r.cells.some((c) => c == null)) : built;
  }, [roster, activeMetrics, bestLift, bestTest, missingOnly]);

  const coverage = useMemo(
    () => activeMetrics.map((m) => {
      const missing = roster.filter((a) => cellFor(a, m) == null);
      return { metric: m, have: roster.length - missing.length, total: roster.length, missing };
    }),
    [activeMetrics, roster, bestLift, bestTest],
  );

  const teamName = teams.find((t) => t.id === activeTeamId)?.name;

  const exportCsv = () => {
    const header = ["Athlete", "Team", ...activeMetrics.flatMap((m) => (m.kind === "lift" ? [`${m.label} e1RM (lb)`, `${m.label} TM ${tmPct}% (lb)`] : [`${m.label} (${m.unit})`]))];
    const body = rows.map((r) => [
      athleteDisplayName(r.athlete),
      teams.find((t) => t.id === r.athlete.team_id)?.name ?? "",
      ...r.cells.flatMap((c, i) => {
        const m = activeMetrics[i];
        if (m.kind === "lift") return c ? [String(round5(c.value)), String(round5(c.value * (tmPct / 100)))] : ["", ""];
        return [c ? String(c.value) : ""];
      }),
    ]);
    const csv = [header, ...body].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `training-maxes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <PageSkeleton variant="table" rows={8} />;

  const grouped = metricOptions.reduce<Record<string, MetricOpt[]>>((acc, m) => {
    (acc[m.group] ||= []).push(m);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        eyebrow="Strength"
        title="Training Maxes"
        description={`Best rep max, estimated 1RM (${ONE_RM_META[formula].label}) and training max per athlete — plus who's missing data for a lift or run.`}
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
          </Button>
        }
      />

      <Tabs defaultValue="training">
        <TabsList className="mb-3">
          <TabsTrigger value="training">Training maxes</TabsTrigger>
          <TabsTrigger value="reps">Rep maxes (1RM–5RM)</TabsTrigger>
        </TabsList>
        <TabsContent value="reps">
          <RepMaxGrid />
        </TabsContent>
        <TabsContent value="training">

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Filters value={filters} onChange={setFilters} athletes={athletes} showDates={false} />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search athlete…"
          className="h-8 w-40 text-xs"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-8 gap-1.5 border-border/60 bg-transparent px-3 text-xs font-medium">
              <span>Lifts &amp; runs · {activeMetrics.length}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-1">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Select columns</span>
              <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => setSelected([])}>
                Clear
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {Object.entries(grouped).map(([group, opts]) => (
                <div key={group}>
                  <div className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                    {group}
                  </div>
                  {opts.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => toggleMetric(o.key)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      <Checkbox checked={activeKeys.includes(o.key)} className="pointer-events-none" />
                      <span className="truncate">{o.label}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <label className="flex h-8 items-center gap-1.5 rounded-md border border-border/60 px-3 text-xs font-medium">
          TM
          <Input
            type="number"
            value={tmPct}
            min={50}
            max={100}
            onChange={(e) => setTmPct(Math.min(100, Math.max(50, Number(e.target.value) || 0)))}
            className="h-6 w-14 border-0 bg-transparent p-0 text-center font-mono text-xs shadow-none focus-visible:ring-0"
          />
          %
        </label>
        <Button
          variant={missingOnly ? "default" : "outline"}
          size="sm"
          className="h-8 text-xs"
          onClick={() => setMissingOnly((v) => !v)}
        >
          <AlertTriangle className="mr-1.5 h-3.5 w-3.5" /> Missing only
        </Button>
      </div>

      {/* Coverage */}
      {activeMetrics.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Data coverage{teamName ? ` — ${teamName}` : ""}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {coverage.map((c) => {
              const pct = c.total ? Math.round((c.have / c.total) * 100) : 0;
              return (
                <div key={c.metric.key} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.metric.label}</span>
                    <span className={cn("stat-number tabular-nums text-sm", pct === 100 ? "text-emerald-500" : pct >= 50 ? "text-foreground" : "text-destructive")}>
                      {c.have}/{c.total}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", pct === 100 ? "bg-emerald-500" : pct >= 50 ? "bg-primary" : "bg-destructive")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {c.missing.length > 0 && (
                    <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">
                      Missing: {c.missing.slice(0, 6).map(athleteDisplayName).join(", ")}
                      {c.missing.length > 6 ? ` +${c.missing.length - 6} more` : ""}
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Matrix */}
      {activeMetrics.length === 0 ? (
        <EmptyState
          icon={Dumbbell}
          title="Pick lifts or runs"
          description="Choose the lifts and tests you want to check from the “Lifts & runs” picker above."
        />
      ) : !rows.length ? (
        <EmptyState
          icon={Dumbbell}
          title={missingOnly ? "Everyone has data" : "No athletes match"}
          description={missingOnly ? "Every athlete in this view has a result for each selected lift or run." : "Adjust the filters or search to see athletes."}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Athlete
                </th>
                {activeMetrics.map((m) => (
                  <th key={m.key} className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {m.label}
                    <div className="text-[9px] font-normal normal-case tracking-normal opacity-70">
                      {m.kind === "lift" ? `e1RM · TM ${tmPct}%` : m.unit}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ athlete, cells }) => (
                <tr key={athlete.id} className="border-t border-border/50 hover:bg-muted/20">
                  <td className="sticky left-0 z-10 bg-background px-3 py-2">
                    <Link to="/athletes/$id" params={{ id: athlete.id }} className="font-medium hover:text-primary">
                      {athleteDisplayName(athlete)}
                    </Link>
                    <div className="text-[10px] text-muted-foreground">
                      {[athlete.grade ? `G${athlete.grade}` : null, athlete.sport].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  {cells.map((c, i) => {
                    const m = activeMetrics[i];
                    if (!c) {
                      return (
                        <td key={m.key} className="px-3 py-2 text-right">
                          <Badge variant="outline" className="border-destructive/40 text-[10px] text-destructive">
                            no data
                          </Badge>
                        </td>
                      );
                    }
                    return (
                      <td key={m.key} className="px-3 py-2 text-right">
                        {m.kind === "lift" ? (
                          <>
                            <div className="stat-number tabular-nums text-base leading-none">
                              {round5(c.value)}
                              <span className="ml-1 text-[10px] text-muted-foreground">lb</span>
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              TM {round5(c.value * (tmPct / 100))} · {c.sub}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="stat-number tabular-nums text-base leading-none">
                              {c.value}
                              <span className="ml-1 text-[10px] text-muted-foreground">{m.unit}</span>
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">{c.date}</div>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        e1RM uses {ONE_RM_META[formula].label} — {ONE_RM_META[formula].expression}. Training max = e1RM × {tmPct}%, rounded to the nearest 5 lb.
        Lift values come from rep maxes and logged lifts matched by exercise name, so a blank cell means nothing has been logged under that exact name.
      </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
