import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useOnboardingState } from "@/hooks/use-onboarding";
import { useQuery } from "@tanstack/react-query";
import {
  athletesQO, teamsQO, testsQO, testTypesQO, athleteTeamsQO,
  athleteDisplayName, workoutAssignmentsQO, workoutsQO, repMaxesQO, liftsQO,
} from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { TEST_TYPES, testTypeMeta as baseTestTypeMeta } from "@/lib/domain";
import { SPORTS, GRADES } from "@/lib/domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Activity, AlertTriangle, Award, ArrowUpRight, CalendarDays, CheckCircle2,
  ChevronDown, CircleDashed, Dumbbell, Filter, LineChart, PlayCircle, TrendingUp, Users, Zap,
} from "lucide-react";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Daily Dashboard — Strength Lab" },
      { name: "description", content: "Everything happening today: sessions, PRs, testing, and roster movement." },
    ],
  }),
  component: DailyDashboard,
});

function fmtDate(d: Date) { return d.toISOString().slice(0, 10); }
function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function DailyDashboard() {
  const today = fmtDate(new Date());
  const [activeTeamId] = useActiveTeamId();
  const navigate = useNavigate();
  const { needsSetup } = useOnboardingState();
  useEffect(() => {
    if (needsSetup) navigate({ to: "/setup", replace: true });
  }, [needsSetup, navigate]);

  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: tests = [] } = useQuery(testsQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const { data: assignments = [] } = useQuery(workoutAssignmentsQO);
  const { data: workouts = [] } = useQuery(workoutsQO);
  const { data: athleteTeams = [] } = useQuery(athleteTeamsQO);
  const { data: repMaxes = [] } = useQuery(repMaxesQO);
  const { data: lifts = [] } = useQuery(liftsQO);

  const { data: setsToday = [] } = useQuery({
    queryKey: ["rack_set_logs_today", today],
    queryFn: async () => {
      const start = `${today}T00:00:00Z`;
      const { data, error } = await supabase.from("rack_set_logs")
        .select("id, athlete_id, status, approval_status, completed_at, load, reps")
        .gte("completed_at", start).order("completed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 20_000,
  });

  const athById = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes]);
  const teamsByAthlete = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of athleteTeams) {
      const s = m.get(r.athlete_id) ?? new Set<string>();
      s.add(r.team_id); m.set(r.athlete_id, s);
    }
    return m;
  }, [athleteTeams]);

  const inScope = (athleteId: string) => {
    if (!activeTeamId) return true;
    const a = athById.get(athleteId);
    if (!a) return false;
    if (a.team_id === activeTeamId) return true;
    return teamsByAthlete.get(athleteId)?.has(activeTeamId) ?? false;
  };

  // Today's assignments
  const todaysAssignments = useMemo(() => {
    let list = assignments.filter((a) => a.scheduled_date === today);
    if (activeTeamId) list = list.filter((a) => !a.team_id || a.team_id === activeTeamId);
    return list;
  }, [assignments, activeTeamId, today]);

  const assignedAthleteIds = useMemo(() => {
    const s = new Set<string>();
    for (const a of todaysAssignments) {
      if (a.athlete_id) { s.add(a.athlete_id); continue; }
      if (a.team_id) for (const at of athleteTeams) if (at.team_id === a.team_id) s.add(at.athlete_id);
    }
    return s;
  }, [todaysAssignments, athleteTeams]);

  const kpis = useMemo(() => {
    const scopedSets = setsToday.filter((s) => inScope(s.athlete_id));
    const completedIds = new Set(scopedSets.filter((s) => s.status === "completed").map((s) => s.athlete_id));
    const activeIds = new Set(scopedSets.map((s) => s.athlete_id));
    const finished = [...completedIds].filter((id) => assignedAthleteIds.has(id)).length;
    const active = [...activeIds].filter((id) => assignedAthleteIds.has(id) && !completedIds.has(id)).length;
    const notStarted = Math.max(0, assignedAthleteIds.size - finished - active);
    const completionPct = assignedAthleteIds.size ? Math.round((finished / assignedAthleteIds.size) * 100) : 0;
    const flagged = scopedSets.filter((s) => s.approval_status === "pending").length;
    const prsToday = repMaxes.filter((r) => (r.tested_at ?? "").slice(0, 10) === today && inScope(r.athlete_id)).length;
    const testsToday = tests.filter((t) => t.test_date === today && inScope(t.athlete_id)).length;
    const liftsToday = lifts.filter((l) => l.lift_date === today && inScope(l.athlete_id)).length;
    return { finished, active, notStarted, completionPct, flagged, prsToday, testsToday, liftsToday };
  }, [setsToday, repMaxes, tests, lifts, assignedAthleteIds, today, activeTeamId]);

  const activeTeams = useMemo(() => {
    const ids = new Set(todaysAssignments.map((a) => a.team_id).filter(Boolean) as string[]);
    return [...ids].map((id) => teams.find((t) => t.id === id)).filter(Boolean);
  }, [todaysAssignments, teams]);

  // Leaderboard movers: today's PRs with delta vs prior best on same exercise
  const movers = useMemo(() => {
    const byAthEx = new Map<string, { load: number; tested_at: string }[]>();
    for (const r of repMaxes) {
      const k = `${r.athlete_id}::${r.exercise_name}`;
      const arr = byAthEx.get(k) ?? [];
      arr.push({ load: Number(r.load), tested_at: r.tested_at });
      byAthEx.set(k, arr);
    }
    const out: Array<{ athleteId: string; name: string; exercise: string; load: number; delta: number | null; reps: number }> = [];
    for (const r of repMaxes) {
      if ((r.tested_at ?? "").slice(0, 10) !== today) continue;
      if (!inScope(r.athlete_id)) continue;
      const k = `${r.athlete_id}::${r.exercise_name}`;
      const prior = (byAthEx.get(k) ?? []).filter((x) => x.tested_at < r.tested_at);
      const priorBest = prior.length ? Math.max(...prior.map((x) => x.load)) : null;
      const load = Number(r.load);
      const delta = priorBest == null ? null : load - priorBest;
      const a = athById.get(r.athlete_id);
      out.push({
        athleteId: r.athlete_id,
        name: a ? athleteDisplayName(a) : "Athlete",
        exercise: r.exercise_name,
        load, delta, reps: r.reps,
      });
    }
    return out.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
  }, [repMaxes, today, activeTeamId, athById]);

  // Activity feed
  type Feed =
    | { kind: "pr"; at: string; athleteId: string; text: string; meta: string }
    | { kind: "set"; at: string; athleteId: string; text: string; meta: string; flagged: boolean }
    | { kind: "test"; at: string; athleteId: string; text: string; meta: string };

  const feed = useMemo<Feed[]>(() => {
    const items: Feed[] = [];
    for (const r of repMaxes.filter((r) => (r.tested_at ?? "").slice(0, 10) === today && inScope(r.athlete_id))) {
      const a = athById.get(r.athlete_id);
      items.push({
        kind: "pr", at: r.tested_at, athleteId: r.athlete_id,
        text: `${a ? athleteDisplayName(a) : "Athlete"} — PR ${r.exercise_name}`,
        meta: `${Number(r.load)}×${r.reps}`,
      });
    }
    for (const s of setsToday.filter((s) => inScope(s.athlete_id)).slice(0, 40)) {
      const a = athById.get(s.athlete_id);
      items.push({
        kind: "set", at: s.completed_at ?? new Date().toISOString(), athleteId: s.athlete_id,
        text: `${a ? athleteDisplayName(a) : "Athlete"} — Set logged`,
        meta: `${s.load ? Number(s.load) : "—"}${s.reps ? ` × ${s.reps}` : ""}`,
        flagged: s.approval_status === "pending",
      });
    }
    for (const t of tests.filter((t) => t.test_date === today && inScope(t.athlete_id)).slice(0, 20)) {
      const a = athById.get(t.athlete_id);
      const m = baseTestTypeMeta(t.test_type);
      items.push({
        kind: "test", at: `${t.test_date}T12:00:00Z`, athleteId: t.athlete_id,
        text: `${a ? athleteDisplayName(a) : "Athlete"} — ${m.label}`,
        meta: `${t.value}${m.unit}`,
      });
    }
    return items.sort((a, b) => (b.at.localeCompare(a.at))).slice(0, 30);
  }, [setsToday, repMaxes, tests, today, activeTeamId, athById]);

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  const totalAssigned = assignedAthleteIds.size;
  const remaining = Math.max(0, totalAssigned - kpis.finished);

  return (
    <div className="space-y-5">
      {/* ── Level 1 — Header ─────────────────────────────────────── */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Daily Dashboard · {todayLabel}
          </div>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight sm:text-3xl">
            {totalAssigned > 0
              ? `${kpis.finished} of ${totalAssigned} athletes complete`
              : "No sessions scheduled today"}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{todaysAssignments.length} sessions</span>
            <span className="text-border">•</span>
            <span>{kpis.active} training now</span>
            <span className="text-border">•</span>
            <span className="text-[color:var(--status-pr)]">{kpis.prsToday} PRs today</span>
            {kpis.flagged > 0 && (
              <>
                <span className="text-border">•</span>
                <span className="text-[color:var(--status-below)]">{kpis.flagged} to review</span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activeTeams.slice(0, 3).map((t) => (
            <Badge key={t!.id} variant="outline" className="gap-1.5 font-normal">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: t!.color ?? "var(--primary)" }} />
              {t!.name}
            </Badge>
          ))}
          <Button asChild size="sm" variant="outline">
            <Link to="/training/today"><CalendarDays className="mr-1.5 h-4 w-4" /> Today</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/rack-console"><PlayCircle className="mr-1.5 h-4 w-4" /> Rack Console</Link>
          </Button>
        </div>
      </header>

      {/* ── Alert bar ────────────────────────────────────────────── */}
      {kpis.flagged > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--status-below)]/30 bg-[color:var(--status-below)]/5 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[color:var(--status-below)]" />
            <span className="font-medium">{kpis.flagged} logged {kpis.flagged === 1 ? "set" : "sets"} awaiting review</span>
            <span className="hidden truncate text-muted-foreground sm:inline">Coach approval required before results count toward PRs.</span>
          </div>
          <Button asChild size="sm" variant="ghost" className="shrink-0">
            <Link to="/log-review">Review <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link>
          </Button>
        </div>
      )}

      {/* ── Level 2 — KPI strip ──────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        <Kpi
          label="Completion"
          value={`${kpis.completionPct}%`}
          sub={`${kpis.finished}/${totalAssigned}`}
          progress={kpis.completionPct}
          tone="info"
        />
        <Kpi
          label="Training now"
          value={kpis.active}
          sub={kpis.active > 0 ? "on the floor" : "idle"}
          tone={kpis.active > 0 ? "info" : "muted"}
          dot={kpis.active > 0}
        />
        <Kpi
          label="Remaining"
          value={remaining}
          sub={totalAssigned > 0 ? `of ${totalAssigned}` : "—"}
          tone={remaining > 0 ? "warn" : "muted"}
        />
        <Kpi
          label="PRs today"
          value={kpis.prsToday}
          sub={movers.length > 0 ? `${movers[0].name.split(" ")[0]} led` : "—"}
          tone="pr"
          icon={<Award className="h-3.5 w-3.5" />}
        />
        <Kpi
          label="Tests logged"
          value={kpis.testsToday}
          sub={`${kpis.liftsToday} lifts`}
          tone="default"
        />
        <Kpi
          label="Needs review"
          value={kpis.flagged}
          sub={kpis.flagged === 0 ? "all clear" : "flagged"}
          tone={kpis.flagged > 0 ? "bad" : "muted"}
        />
      </section>

      {/* ── Level 2 — Main content grid ──────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Scheduled sessions — takes 2/3 */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-2.5">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold">Scheduled sessions</CardTitle>
              <Badge variant="outline" className="text-[10px] font-normal">
                {todaysAssignments.length}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[color:var(--status-pr)]" /> Done {kpis.finished}</span>
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> Active {kpis.active}</span>
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" /> Idle {kpis.notStarted}</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {todaysAssignments.length === 0 ? (
              <EmptyRow label="Nothing scheduled today." />
            ) : (
              <ul className="divide-y divide-border">
                {todaysAssignments.map((a) => {
                  const w = workouts.find((x) => x.id === a.workout_id);
                  const t = a.team_id ? teams.find((x) => x.id === a.team_id) : null;
                  const ath = a.athlete_id ? athletes.find((x) => x.id === a.athlete_id) : null;
                  const statusTone =
                    a.status === "completed" ? "text-[color:var(--status-pr)]"
                    : a.status === "in_progress" ? "text-primary"
                    : "text-muted-foreground";
                  return (
                    <li key={a.id} className="group flex items-center justify-between gap-3 px-4 py-2.5 transition hover:bg-accent/40">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                          <Dumbbell className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{w?.name ?? "Session"}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {t?.name ?? (ath?.name ?? "All athletes")}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {a.status && (
                          <span className={`text-xs capitalize ${statusTone}`}>
                            {String(a.status).replace("_", " ")}
                          </span>
                        )}
                        <Button asChild size="sm" variant="ghost" className="opacity-60 group-hover:opacity-100">
                          <Link to="/rack-console">Open <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Right rail — grouped info */}
        <Card>
          <CardHeader className="border-b border-border pb-2.5">
            <CardTitle className="text-sm font-semibold">Volume today</CardTitle>
          </CardHeader>
          <CardContent className="p-0 text-sm">
            <RowKV label="Rack sets logged" value={setsToday.filter((s) => inScope(s.athlete_id)).length} icon={<Activity className="h-3.5 w-3.5" />} />
            <RowKV label="Lifts logged" value={kpis.liftsToday} icon={<Dumbbell className="h-3.5 w-3.5" />} />
            <RowKV label="Tests recorded" value={kpis.testsToday} icon={<LineChart className="h-3.5 w-3.5" />} />
            <RowKV label="PRs set" value={kpis.prsToday} icon={<Award className="h-3.5 w-3.5" />} accent="pr" />
          </CardContent>
        </Card>
      </div>

      {/* ── Level 3 — This week (deep dive, collapsed by default) ─ */}
      <Collapsible defaultOpen={false} className="mt-2">
        <CollapsibleTrigger asChild>
          <button className="group flex w-full items-center justify-between rounded-lg border border-border bg-card/40 px-4 py-2.5 text-left hover:bg-accent/40">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">This week</span>
              <span className="text-xs text-muted-foreground">
                Leaderboard, live activity, historical trends
              </span>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4 space-y-5">
          {/* ── Leaderboard + Live activity ─────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-2.5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-[color:var(--status-pr)]" />
                  Leaderboard movement
                </CardTitle>
                <Button asChild size="sm" variant="ghost" className="text-xs">
                  <Link to="/leaderboards">All boards <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {movers.length === 0 ? (
                  <EmptyRow label="No PRs today — yet." />
                ) : (
                  <ul className="divide-y divide-border">
                    {movers.slice(0, 8).map((m, i) => (
                      <li key={`${m.athleteId}-${m.exercise}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2 transition hover:bg-accent/40">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="mono-number w-5 shrink-0 text-center text-xs text-muted-foreground">{i + 1}</span>
                          <div className="min-w-0">
                            <Link to="/athletes/$id" params={{ id: m.athleteId }} className="truncate text-sm font-medium hover:underline">
                              {m.name}
                            </Link>
                            <div className="truncate text-xs text-muted-foreground">{m.exercise}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="mono-number text-sm">{m.load}<span className="text-muted-foreground">×{m.reps}</span></span>
                          {m.delta == null ? (
                            <span className="text-[11px] text-muted-foreground">First</span>
                          ) : m.delta > 0 ? (
                            <span className="mono-number inline-flex items-center gap-0.5 rounded-md bg-[color:var(--status-pr)]/10 px-1.5 py-0.5 text-xs font-semibold text-[color:var(--status-pr)]">
                              <TrendingUp className="h-3 w-3" />+{m.delta}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">±0</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-2.5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" /> Live activity
                </CardTitle>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--status-pr)] animate-pulse" />
                  Live
                </span>
              </CardHeader>
              <CardContent className="p-0">
                {feed.length === 0 ? (
                  <EmptyRow label="No activity yet today." />
                ) : (
                  <ol className="max-h-[420px] overflow-y-auto divide-y divide-border">
                    {feed.map((f, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              f.kind === "pr" ? "bg-[color:var(--status-pr)]"
                              : f.kind === "test" ? "bg-primary"
                              : (f as { flagged?: boolean }).flagged ? "bg-[color:var(--status-below)]"
                              : "bg-muted-foreground/50"
                            }`}
                          />
                          <Link to="/athletes/$id" params={{ id: f.athleteId }} className="truncate text-sm hover:underline">
                            {f.text}
                          </Link>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                          <span className="mono-number">{f.meta}</span>
                          <span>·</span>
                          <span>{timeAgo(f.at)}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Historical trend table */}
          <MetricTrend
            athletes={athletes}
            tests={tests}
            customTypes={customTypes}
            athleteTeams={athleteTeams}
            activeTeamId={activeTeamId}
            teams={teams}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}


/* -------------------- UI atoms -------------------- */

function Kpi({
  label, value, sub, tone = "default", icon, progress, dot,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: "default" | "info" | "muted" | "pr" | "warn" | "bad";
  icon?: React.ReactNode;
  progress?: number;
  dot?: boolean;
}) {
  const toneClass =
    tone === "info" ? "text-primary"
    : tone === "pr" ? "text-[color:var(--status-pr)]"
    : tone === "warn" ? "text-[color:var(--status-near)]"
    : tone === "bad" ? "text-[color:var(--status-below)]"
    : tone === "muted" ? "text-muted-foreground"
    : "text-foreground";
  const barClass =
    tone === "pr" ? "bg-[color:var(--status-pr)]"
    : tone === "warn" ? "bg-[color:var(--status-near)]"
    : tone === "bad" ? "bg-[color:var(--status-below)]"
    : "bg-primary";
  return (
    <div className="bg-card p-3.5">
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        {dot && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <div className={`mono-number text-2xl font-semibold leading-none tracking-tight ${toneClass}`}>{value}</div>
        {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
      {typeof progress === "number" && (
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className={`h-full transition-all ${barClass}`} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
    </div>
  );
}

function RowKV({ label, value, accent, icon }: { label: string; value: number | string; accent?: "pr"; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5 last:border-b-0">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={`mono-number text-sm font-semibold tabular-nums ${accent === "pr" ? "text-[color:var(--status-pr)]" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <div className="p-8 text-center text-sm text-muted-foreground">{label}</div>;
}


/* -------------------- Metric trend (preserved) -------------------- */

type Athlete = ReturnType<typeof useQuery<typeof athletesQO>> extends never ? never : never;

function MetricTrend(props: {
  athletes: ReturnType<typeof useMemoAthletes>;
  tests: ReturnType<typeof useMemoTests>;
  customTypes: ReturnType<typeof useMemoCustom>;
  athleteTeams: ReturnType<typeof useMemoAT>;
  teams: ReturnType<typeof useMemoTeams>;
  activeTeamId: string | null;
}) {
  const { athletes, tests, customTypes, athleteTeams, activeTeamId, teams } = props;

  const allTestTypes = useMemo(() => {
    const base = TEST_TYPES.map((t) => ({
      value: t.value as string, label: t.label, unit: t.unit,
      lowerIsBetter: t.lowerIsBetter, group: t.group,
    }));
    const custom = customTypes.map((c) => ({
      value: c.value, label: c.label, unit: c.unit,
      lowerIsBetter: c.lower_is_better, group: c.group_name,
    }));
    const seen = new Set(base.map((t) => t.value));
    return [...base, ...custom.filter((c) => !seen.has(c.value))];
  }, [customTypes]);
  const testTypeMeta = (v: string) => allTestTypes.find((t) => t.value === v) ?? baseTestTypeMeta(v);

  const testedTypes = useMemo(() => {
    const s = new Set<string>();
    tests.forEach((t) => s.add(t.test_type));
    return s;
  }, [tests]);
  const defaultMetric = useMemo(() => {
    if (testedTypes.has("sprint_40y")) return "sprint_40y";
    const firstTested = allTestTypes.find((t) => testedTypes.has(t.value));
    return firstTested?.value ?? "sprint_40y";
  }, [testedTypes, allTestTypes]);

  const [metric, setMetric] = useState<string>(defaultMetric);
  useEffect(() => { setMetric((m) => (testedTypes.has(m) ? m : defaultMetric)); }, [defaultMetric, testedTypes]);
  const [grade, setGrade] = useState<string>("all");
  const [sport, setSport] = useState<string>("all");
  const [gradYear, setGradYear] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [selectedDates, setSelectedDates] = useState<Set<string> | null>(null);

  const meta = testTypeMeta(metric);
  const lowerIsBetter = meta.lowerIsBetter;

  const gradYears = useMemo(() => {
    const s = new Set<number>();
    athletes.forEach((a) => a.graduation_year && s.add(a.graduation_year));
    return Array.from(s).sort();
  }, [athletes]);

  const teamsByAthlete = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of athleteTeams) {
      const s = m.get(r.athlete_id) ?? new Set<string>();
      s.add(r.team_id); m.set(r.athlete_id, s);
    }
    return m;
  }, [athleteTeams]);

  const filteredAthletes = useMemo(() => athletes.filter((a) => {
    if (activeTeamId) {
      const extras = teamsByAthlete.get(a.id);
      const belongs = a.team_id === activeTeamId || (extras?.has(activeTeamId) ?? false);
      if (!belongs) return false;
    }
    if (grade !== "all" && String(a.grade) !== grade) return false;
    if (sport !== "all" && a.sport !== sport) return false;
    if (gradYear !== "all" && String(a.graduation_year) !== gradYear) return false;
    return true;
  }), [athletes, activeTeamId, teamsByAthlete, grade, sport, gradYear]);

  const athleteIds = useMemo(() => new Set(filteredAthletes.map((a) => a.id)), [filteredAthletes]);

  const scopedTests = useMemo(() => tests.filter((t) => {
    if (t.test_type !== metric) return false;
    if (!athleteIds.has(t.athlete_id)) return false;
    if (from && t.test_date < from) return false;
    if (to && t.test_date > to) return false;
    return true;
  }), [tests, metric, athleteIds, from, to]);

  const allDates = useMemo(() => {
    const s = new Set<string>();
    scopedTests.forEach((t) => s.add(t.test_date));
    return Array.from(s).sort().reverse();
  }, [scopedTests]);

  const activeDates = useMemo(() => {
    if (!selectedDates) return allDates;
    return allDates.filter((d) => selectedDates.has(d));
  }, [allDates, selectedDates]);

  const grid = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const t of scopedTests) {
      let row = map.get(t.athlete_id);
      if (!row) { row = new Map(); map.set(t.athlete_id, row); }
      const cur = row.get(t.test_date);
      if (cur == null || (lowerIsBetter ? t.value < cur : t.value > cur)) row.set(t.test_date, t.value);
    }
    return map;
  }, [scopedTests, lowerIsBetter]);

  const rows = useMemo(() => filteredAthletes.map((a) => {
    const row = grid.get(a.id);
    const values: number[] = [];
    if (row) activeDates.forEach((d) => { const v = row.get(d); if (v != null) values.push(v); });
    const best = values.length ? (lowerIsBetter ? Math.min(...values) : Math.max(...values)) : null;
    const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
    return { athlete: a, row, best, avg, count: values.length };
  }).filter((r) => r.count > 0)
    .sort((a, b) => {
      if (a.best == null) return 1;
      if (b.best == null) return -1;
      return lowerIsBetter ? a.best - b.best : b.best - a.best;
    }), [filteredAthletes, grid, activeDates, lowerIsBetter]);

  function toggleDate(d: string) {
    setSelectedDates((prev) => {
      const base = prev ?? new Set(allDates);
      const next = new Set(base);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  }

  const fmt = (v: number | null) => v == null ? "—" : `${v.toFixed(2)}${meta.unit}`;

  // Row visibility: search + show top N unless expanded
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => athleteDisplayName(r.athlete).toLowerCase().includes(q));
  }, [rows, search]);
  const visibleRows = useMemo(
    () => (showAll || search.trim() ? searched : searched.slice(0, 10)),
    [searched, showAll, search],
  );

  // 95% threshold relative to each athlete's best
  const nearPR = (v: number, best: number | null) => {
    if (best == null || v === best) return false;
    return lowerIsBetter ? v <= best / 0.95 : v >= best * 0.95;
  };


  return (
    <Card className="overflow-hidden border-border/60">
      <CardHeader className="gap-3 border-b border-border/50 bg-muted/20 pb-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
          <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
            <LineChart className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate">Metric trend</span>
            <Badge variant="outline" className="hidden text-[11px] font-normal sm:inline-flex">
              {meta.label} · {lowerIsBetter ? "Lower is better" : "Higher is better"}
            </Badge>
          </CardTitle>
          <div className="flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> PR
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" /> ≥95%
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              <Filter className="h-3.5 w-3.5" /> Filters
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger><SelectValue placeholder="Metric" /></SelectTrigger>
            <SelectContent>
              {allTestTypes.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}{testedTypes.has(t.value) ? "" : " (no data)"}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={grade} onValueChange={setGrade}>
            <SelectTrigger><SelectValue placeholder="Grade" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All grades</SelectItem>
              {GRADES.map((g) => <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sport} onValueChange={setSport}>
            <SelectTrigger><SelectValue placeholder="Sport" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sports</SelectItem>
              {SPORTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={gradYear} onValueChange={setGradYear}>
            <SelectTrigger><SelectValue placeholder="Grad year" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All grad years</SelectItem>
              {gradYears.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </div>

        {activeTeamId && (
          <div className="flex items-center gap-2 text-xs text-primary">
            Scoped to team: {teams.find((t) => t.id === activeTeamId)?.name ?? "Selected"}
          </div>
        )}

        {allDates.length > 0 && (
          <div className="rounded-md border border-border/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs text-muted-foreground">Dates ({activeDates.length}/{allDates.length} selected)</div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedDates(null)}>All</Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedDates(new Set())}>None</Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allDates.map((d) => {
                const active = !selectedDates || selectedDates.has(d);
                return (
                  <label key={d} className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${active ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}>
                    <Checkbox checked={active} onCheckedChange={() => toggleDate(d)} />
                    {d}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search athlete…"
            className="h-9"
            aria-label="Search athlete"
          />
          <div className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {visibleRows.length} / {rows.length}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border/60">
          {visibleRows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No results for the current filters.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="sticky left-0 bg-card text-[11px] uppercase tracking-wider">Athlete</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-wider">Best</TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-wider">Average</TableHead>
                  {activeDates.map((d) => (
                    <TableHead key={d} className="whitespace-nowrap text-right text-[11px] uppercase tracking-wider">{d}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map(({ athlete, row, best, avg }) => (
                  <TableRow key={athlete.id} className="hover:bg-muted/20">
                    <TableCell className="sticky left-0 bg-card font-medium">
                      <Link to="/athletes/$id" params={{ id: athlete.id }} className="hover:underline">
                        {athleteDisplayName(athlete)}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {[athlete.sport, athlete.grade && `G${athlete.grade}`, athlete.position].filter(Boolean).join(" · ")}
                      </div>
                    </TableCell>
                    <TableCell className="mono-number text-right font-semibold text-emerald-500">{fmt(best)}</TableCell>
                    <TableCell className="mono-number text-right text-muted-foreground">{fmt(avg)}</TableCell>
                    {activeDates.map((d) => {
                      const v = row?.get(d);
                      const isBest = v != null && v === best;
                      const near = v != null && nearPR(v, best);
                      return (
                        <TableCell
                          key={d}
                          className={`mono-number whitespace-nowrap text-right ${
                            isBest
                              ? "font-semibold text-emerald-500"
                              : near
                                ? "text-amber-500"
                                : "text-muted-foreground"
                          }`}
                        >
                          {v == null ? "—" : fmt(v)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {!search.trim() && rows.length > 10 && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show top 10" : `Show all ${rows.length} athletes`}
          </Button>
        )}

      </CardContent>
    </Card>
  );
}

/* Type helpers so MetricTrend props stay simple */
function useMemoAthletes() { return useQuery(athletesQO).data ?? []; }
function useMemoTests() { return useQuery(testsQO).data ?? []; }
function useMemoCustom() { return useQuery(testTypesQO).data ?? []; }
function useMemoAT() { return useQuery(athleteTeamsQO).data ?? []; }
function useMemoTeams() { return useQuery(teamsQO).data ?? []; }
