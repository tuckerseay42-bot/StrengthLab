import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  workoutAssignmentsQO, workoutsQO, athletesQO, athleteTeamsQO,
  teamsQO, repMaxesQO,
} from "@/lib/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, Award, CheckCircle2, CircleDashed, PlayCircle,
  Users, UserCheck, Activity, Flame, ClipboardList, Plus, Radio,
  ArrowUpRight, TrendingUp,
} from "lucide-react";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/training/today")({
  head: () => ({ meta: [{ title: "Training — Today" }] }),
  component: TodayView,
});

function fmtDate(d: Date) { return d.toISOString().slice(0, 10); }

function TodayView() {
  const today = fmtDate(new Date());
  const [activeTeamId] = useActiveTeamId();

  const { data: assignments = [] } = useQuery(workoutAssignmentsQO);
  const { data: workouts = [] } = useQuery(workoutsQO);
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: athleteTeams = [] } = useQuery(athleteTeamsQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: repMaxes = [] } = useQuery(repMaxesQO);

  const { data: rackSessions = [] } = useQuery({
    queryKey: ["rack_sessions_today", today],
    queryFn: async () => {
      const start = `${today}T00:00:00Z`;
      const { data, error } = await supabase.from("rack_sessions")
        .select("*").gte("started_at", start).order("started_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 20_000,
  });

  const { data: setsToday = [] } = useQuery({
    queryKey: ["rack_set_logs_today", today],
    queryFn: async () => {
      const start = `${today}T00:00:00Z`;
      const { data, error } = await supabase.from("rack_set_logs")
        .select("id, athlete_id, workout_exercise_id, status, approval_status, completed_at, load, reps")
        .gte("completed_at", start)
        .order("completed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15_000,
  });

  const { data: attendanceToday = [] } = useQuery({
    queryKey: ["attendance_today", today],
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance")
        .select("athlete_id, present, session_date")
        .eq("session_date", today);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  const { data: exerciseNames = {} } = useQuery({
    queryKey: ["workout_exercise_names"],
    queryFn: async () => {
      const { data, error } = await supabase.from("workout_exercises")
        .select("id, exercise_name");
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((e) => [e.id, e.exercise_name]));
    },
    staleTime: 60_000,
  });

  const todaysAssignments = useMemo(() => {
    let list = assignments.filter((a) => a.scheduled_date === today);
    if (activeTeamId) list = list.filter((a) => !a.team_id || a.team_id === activeTeamId);
    return list;
  }, [assignments, activeTeamId, today]);

  const assignedAthleteIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of todaysAssignments) {
      if (a.athlete_id) { set.add(a.athlete_id); continue; }
      if (a.team_id) {
        for (const at of athleteTeams) if (at.team_id === a.team_id) set.add(at.athlete_id);
      }
    }
    return set;
  }, [todaysAssignments, athleteTeams]);

  const checkedInIds = useMemo(
    () => new Set(attendanceToday.filter((a) => a.present).map((a) => a.athlete_id)),
    [attendanceToday],
  );

  const stats = useMemo(() => {
    const completedIds = new Set(setsToday.filter((s) => s.status === "completed").map((s) => s.athlete_id));
    const activeAthleteIds = new Set(setsToday.map((s) => s.athlete_id));
    const flagged = setsToday.filter((s) => s.approval_status === "pending").length;
    const totalSets = setsToday.filter((s) => s.status === "completed").length;
    const finished = [...completedIds].filter((id) => assignedAthleteIds.has(id)).length;
    const active = [...activeAthleteIds].filter((id) => assignedAthleteIds.has(id) && !completedIds.has(id)).length;
    const checkedIn = [...checkedInIds].filter((id) => assignedAthleteIds.has(id) || checkedInIds.has(id)).length;
    const notStarted = Math.max(0, assignedAthleteIds.size - active - finished);
    const completionPct = assignedAthleteIds.size
      ? Math.round((finished / assignedAthleteIds.size) * 100) : 0;
    const prsToday = repMaxes.filter((r) => (r.tested_at ?? "").slice(0, 10) === today).length;
    return { flagged, finished, active, notStarted, completionPct, prsToday, checkedIn, totalSets };
  }, [setsToday, assignedAthleteIds, checkedInIds, repMaxes, today]);

  const activeTeams = useMemo(() => {
    const ids = new Set(todaysAssignments.map((a) => a.team_id).filter(Boolean) as string[]);
    return [...ids].map((id) => teams.find((t) => t.id === id)).filter(Boolean);
  }, [todaysAssignments, teams]);

  const todayPRs = useMemo(
    () => repMaxes
      .filter((r) => (r.tested_at ?? "").slice(0, 10) === today)
      .slice(0, 8),
    [repMaxes, today],
  );

  const activityFeed = useMemo(() => setsToday.slice(0, 12), [setsToday]);

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  const athleteById = useMemo(
    () => Object.fromEntries(athletes.map((a) => [a.id, a])),
    [athletes],
  );

  return (
    <div className="space-y-5">
      {/* Header + Quick Actions */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Training Home</div>
          <div className="mt-0.5 flex items-baseline gap-3">
            <h2 className="text-2xl font-semibold sm:text-3xl">{todayLabel}</h2>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live · auto-refresh
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {activeTeams.length === 0 ? (
              <span className="text-xs text-muted-foreground">No teams scheduled</span>
            ) : activeTeams.map((t) => (
              <Badge key={t!.id} variant="outline" className="gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: t!.color ?? "hsl(var(--primary))" }} />
                {t!.name}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" className="gap-1.5">
            <Link to="/live-leaderboard"><Radio className="h-4 w-4" /> Open Live Room</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/workouts"><Plus className="h-4 w-4" /> Build Session</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/attendance"><UserCheck className="h-4 w-4" /> Attendance</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/log-review">
              <ClipboardList className="h-4 w-4" /> Review
              {stats.flagged > 0 && (
                <span className="ml-1 rounded-full bg-[color:var(--status-near,hsl(var(--primary)))] px-1.5 text-[10px] font-semibold text-background">
                  {stats.flagged}
                </span>
              )}
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Sessions" value={todaysAssignments.length} icon={<PlayCircle className="h-3.5 w-3.5" />} />
        <Kpi label="Assigned" value={assignedAthleteIds.size} icon={<Users className="h-3.5 w-3.5" />} />
        <Kpi label="Checked in" value={stats.checkedIn} tone="info" icon={<UserCheck className="h-3.5 w-3.5" />} />
        <Kpi label="Training now" value={stats.active} tone="info" icon={<Activity className="h-3.5 w-3.5" />} pulse />
        <Kpi label="Finished" value={stats.finished} tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
        <Kpi label="Not started" value={stats.notStarted} tone="muted" icon={<CircleDashed className="h-3.5 w-3.5" />} />
        <Kpi label="Completion" value={`${stats.completionPct}%`} tone="info" icon={<TrendingUp className="h-3.5 w-3.5" />} />
        <Kpi label="PRs today" value={stats.prsToday} tone="success" icon={<Award className="h-3.5 w-3.5" />} />
      </div>

      {/* Completion bar */}
      {assignedAthleteIds.size > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="uppercase tracking-wide text-muted-foreground">Session progress</span>
              <span className="tabular-nums text-muted-foreground">
                {stats.finished}/{assignedAthleteIds.size} finished · {stats.totalSets} sets logged · {stats.flagged} flagged
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[color:var(--status-info,hsl(var(--primary)))] to-primary transition-all duration-500"
                style={{ width: `${stats.completionPct}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Sessions */}
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <div className="font-medium">Scheduled sessions</div>
                <span className="text-xs text-muted-foreground">{todaysAssignments.length} today</span>
              </div>
              <Button asChild size="sm" variant="ghost" className="h-7 gap-1 text-xs">
                <Link to="/training/calendar">Calendar <ArrowUpRight className="h-3 w-3" /></Link>
              </Button>
            </div>
            {todaysAssignments.length === 0 ? (
              <div className="rounded-md border border-dashed p-8 text-center">
                <div className="text-sm text-muted-foreground">Nothing scheduled today.</div>
                <Button asChild size="sm" variant="outline" className="mt-3 gap-1.5">
                  <Link to="/workouts"><Plus className="h-3.5 w-3.5" /> Assign a workout</Link>
                </Button>
              </div>
            ) : (
              <ul className="space-y-2">
                {todaysAssignments.map((a) => {
                  const w = workouts.find((x) => x.id === a.workout_id);
                  const t = a.team_id ? teams.find((x) => x.id === a.team_id) : null;
                  const ath = a.athlete_id ? athletes.find((x) => x.id === a.athlete_id) : null;
                  const sessionForWorkout = rackSessions.find(
                    (s) => (s as { workout_id?: string }).workout_id === a.workout_id,
                  );
                  const teamAthletes = a.team_id
                    ? athleteTeams.filter((at) => at.team_id === a.team_id).length
                    : (a.athlete_id ? 1 : 0);
                  const teamActive = a.team_id
                    ? new Set(
                        setsToday
                          .filter((s) => {
                            const ath = athleteById[s.athlete_id];
                            return ath?.team_id === a.team_id;
                          })
                          .map((s) => s.athlete_id),
                      ).size
                    : 0;
                  return (
                    <li
                      key={a.id}
                      className="group flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-muted/30"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {t && (
                          <span
                            className="h-8 w-1 shrink-0 rounded-full"
                            style={{ background: t.color ?? "hsl(var(--primary))" }}
                          />
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium">{w?.name ?? "Session"}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            <span>{t?.name ?? ath?.name ?? "All athletes"}</span>
                            {teamAthletes > 0 && (
                              <>
                                <span>·</span>
                                <span className="tabular-nums">{teamAthletes} assigned</span>
                              </>
                            )}
                            {teamActive > 0 && (
                              <>
                                <span>·</span>
                                <span className="tabular-nums text-[color:var(--status-info,hsl(var(--primary)))]">
                                  {teamActive} active
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {a.status && <Badge variant="outline" className="capitalize">{a.status}</Badge>}
                        <Button asChild size="sm" variant="outline">
                          <Link
                            to="/rack-console"
                            search={sessionForWorkout ? { session: (sessionForWorkout as { id: string }).id } : undefined}
                          >
                            Open
                          </Link>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Right rail */}
        <div className="space-y-4">
          {/* PRs today */}
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium">
                  <Flame className="h-4 w-4 text-[color:var(--status-pr,hsl(var(--primary)))]" />
                  PRs today
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">{stats.prsToday}</span>
              </div>
              {todayPRs.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  No new PRs yet.
                </div>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {todayPRs.map((r) => {
                    const a = athleteById[r.athlete_id];
                    return (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-muted/40"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar name={a?.name} />
                          <span className="min-w-0 truncate">
                            <span className="font-medium">{a?.name ?? "Athlete"}</span>{" "}
                            <span className="text-xs text-muted-foreground">— {r.exercise_name}</span>
                          </span>
                        </div>
                        <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                          {Number(r.load)}×{r.reps}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Needs review */}
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className={cn(
                    "h-4 w-4",
                    stats.flagged > 0 ? "text-[color:var(--status-near,hsl(var(--primary)))]" : "text-muted-foreground",
                  )} />
                  Needs review
                </div>
                {stats.flagged > 0 && (
                  <Badge variant="outline" className="border-[color:var(--status-near,hsl(var(--primary)))] text-[color:var(--status-near,hsl(var(--primary)))]">
                    {stats.flagged}
                  </Badge>
                )}
              </div>
              {stats.flagged === 0 ? (
                <div className="text-xs text-muted-foreground">All entries validated.</div>
              ) : (
                <Button asChild size="sm" variant="outline" className="w-full">
                  <Link to="/log-review">Review {stats.flagged} entries</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Activity Feed — full width */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium">
              <Activity className="h-4 w-4 text-[color:var(--status-info,hsl(var(--primary)))]" />
              Live activity
            </div>
            <span className="text-xs text-muted-foreground">Latest sets logged today</span>
          </div>
          {activityFeed.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No activity yet today.
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {activityFeed.map((s) => {
                const a = athleteById[s.athlete_id];
                const ex = exerciseNames[s.workout_exercise_id] ?? "Exercise";
                const when = s.completed_at ? new Date(s.completed_at) : null;
                const rel = when ? relativeTime(when) : "";
                const isPending = s.approval_status === "pending";
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={a?.name} />
                      <div className="min-w-0">
                        <div className="truncate">
                          <span className="font-medium">{a?.name ?? "Athlete"}</span>{" "}
                          <span className="text-muted-foreground">logged</span>{" "}
                          <span className="font-medium">{ex}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{rel}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {s.load != null && s.reps != null && (
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {Number(s.load)}×{s.reps}
                        </span>
                      )}
                      {isPending && (
                        <Badge variant="outline" className="border-[color:var(--status-near,hsl(var(--primary)))] text-[color:var(--status-near,hsl(var(--primary)))]">
                          Review
                        </Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  label, value, icon, tone = "default", pulse,
}: {
  label: string; value: number | string; icon?: React.ReactNode;
  tone?: "default" | "success" | "muted" | "info"; pulse?: boolean;
}) {
  const toneClass =
    tone === "success" ? "text-[color:var(--status-pr,hsl(var(--primary)))]"
    : tone === "info" ? "text-[color:var(--status-info,hsl(var(--primary)))]"
    : tone === "muted" ? "text-muted-foreground"
    : "text-foreground";
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
          <span>{label}</span>
          <span className={cn("opacity-70", pulse && "animate-pulse")}>{icon}</span>
        </div>
        <div className={cn("mt-1 text-2xl font-semibold tabular-nums leading-none", toneClass)}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function Avatar({ name }: { name?: string | null }) {
  const initials = (name ?? "?")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "").join("") || "?";
  // deterministic hue from name
  let hash = 0;
  for (let i = 0; i < (name ?? "").length; i++) hash = (hash * 31 + (name ?? "").charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return (
    <span
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={{ background: `hsl(${hue} 55% 45%)` }}
    >
      {initials}
    </span>
  );
}

function relativeTime(d: Date): string {
  const s = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
