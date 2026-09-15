import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  athletesQO, teamsQO, workoutsQO, workoutExercisesQO, workoutSetsQO, athleteDisplayName,
  type Athlete, type Team, type Workout, type WorkoutExercise, type WorkoutSet,
} from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity, Users, Dumbbell, CheckCircle2, AlertTriangle, Flame,
  RefreshCw, Clock, ExternalLink, Zap, Pause, Play,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/training/live")({
  head: () => ({ meta: [{ title: "Live Training — Strength Lab" }] }),
  component: LiveTrainingPage,
});

// ---------- helpers ----------
function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[p.length - 1]?.[0] ?? "")).toUpperCase() || "?";
}
function timeAgo(iso: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}
function useNow(interval = 5000) {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setN(Date.now()), interval);
    return () => window.clearInterval(id);
  }, [interval]);
  return n;
}

// ---------- data types ----------
type RackSession = {
  id: string; rack_number: number; team_id: string; workout_id: string | null;
  status: string; session_date: string; active_athlete_id: string | null;
  athlete_ids: string[]; organization_id: string;
};
type RackSessionAthlete = {
  id: string; rack_session_id: string; athlete_id: string; quadrant: number;
  active_workout_id: string | null; assigned_workout_id: string | null;
};
type RackSetLog = {
  id: string; rack_session_id: string; athlete_id: string; workout_exercise_id: string;
  set_position: number; load: number | null; reps: number | null;
  avg_velocity: number | null; estimated_1rm: number | null;
  prescribed_load: number | null; prescribed_reps: number | null;
  status: string; approval_status: string; validation_status: string;
  override_status: string | null; review_reason: string | null;
  completed_at: string; created_at: string;
};

const JUST_LOGGED_MS = 25_000;

function useTodayRackSessions(enabled: boolean) {
  return useQuery({
    queryKey: ["live_rack_sessions", localDateKey()],
    enabled,
    refetchInterval: enabled ? 15_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rack_sessions").select("*")
        .eq("session_date", localDateKey())
        .order("rack_number");
      if (error) throw error;
      return (data ?? []) as RackSession[];
    },
  });
}
function useRackSessionAthletes(enabled: boolean) {
  return useQuery({
    queryKey: ["live_rack_session_athletes", localDateKey()],
    enabled,
    refetchInterval: enabled ? 30_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase.from("rack_session_athletes").select("*");
      if (error) throw error;
      return (data ?? []) as RackSessionAthlete[];
    },
  });
}
function useTodaySetLogs(enabled: boolean) {
  return useQuery({
    queryKey: ["live_set_logs", localDateKey()],
    enabled,
    refetchInterval: enabled ? 15_000 : false,
    queryFn: async () => {
      const since = new Date(); since.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("rack_set_logs").select("*")
        .gte("completed_at", since.toISOString())
        .order("completed_at", { ascending: false })
        .limit(400);
      if (error) throw error;
      return (data ?? []) as RackSetLog[];
    },
  });
}

// ---------- page ----------
function LiveTrainingPage() {
  const qc = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const now = useNow(3000);

  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: workouts = [] } = useQuery(workoutsQO);
  const { data: exercises = [] } = useQuery(workoutExercisesQO);
  const { data: sets = [] } = useQuery(workoutSetsQO);
  const { data: rackSessions = [] } = useTodayRackSessions(autoRefresh);
  const { data: rsAthletes = [] } = useRackSessionAthletes(autoRefresh);
  const { data: setLogs = [] } = useTodaySetLogs(autoRefresh);

  useEffect(() => {
    if (!autoRefresh) return;
    const inv = () => {
      qc.invalidateQueries({ queryKey: ["live_set_logs", localDateKey()] });
      qc.invalidateQueries({ queryKey: ["live_rack_sessions", localDateKey()] });
      qc.invalidateQueries({ queryKey: ["live_rack_session_athletes", localDateKey()] });
    };
    const ch = supabase.channel("training-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "rack_set_logs" }, inv)
      .on("postgres_changes", { event: "*", schema: "public", table: "rack_sessions" }, inv)
      .on("postgres_changes", { event: "*", schema: "public", table: "rack_session_athletes" }, inv)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, autoRefresh]);

  // ---- indexes ----
  const athleteById = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const workoutById = useMemo(() => new Map(workouts.map((w) => [w.id, w])), [workouts]);
  const exerciseById = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const exercisesByWorkout = useMemo(() => {
    const m = new Map<string, WorkoutExercise[]>();
    for (const e of exercises) {
      if (!e.workout_id) continue;
      const arr = m.get(e.workout_id) ?? [];
      arr.push(e);
      m.set(e.workout_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.position - b.position);
    return m;
  }, [exercises]);
  const setsByExercise = useMemo(() => {
    const m = new Map<string, WorkoutSet[]>();
    for (const s of sets) {
      const arr = m.get(s.workout_exercise_id) ?? [];
      arr.push(s);
      m.set(s.workout_exercise_id, arr);
    }
    return m;
  }, [sets]);
  const logsByAthlete = useMemo(() => {
    const m = new Map<string, RackSetLog[]>();
    for (const l of setLogs) {
      const arr = m.get(l.athlete_id) ?? [];
      arr.push(l);
      m.set(l.athlete_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.set_position - b.set_position);
    return m;
  }, [setLogs]);

  // ---- KPIs ----
  const activeSessions = rackSessions.filter((s) => s.status !== "completed");
  const trainingAthleteIds = new Set<string>();
  for (const rsa of rsAthletes) {
    if (activeSessions.some((s) => s.id === rsa.rack_session_id)) trainingAthleteIds.add(rsa.athlete_id);
  }
  const totalLogs = setLogs.length;
  const prs = setLogs.filter((l) => l.override_status === "pr" || l.review_reason === "pr").length;
  const flagged = setLogs.filter((l) => l.approval_status === "pending_review" || l.validation_status === "flagged").length;
  const completedSessions = rackSessions.filter((s) => s.status === "completed").length;

  return (
    <div className="space-y-4">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 -mx-1 space-y-3 border-b border-border/60 bg-background/95 px-1 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span className={cn("h-1.5 w-1.5 rounded-full bg-emerald-500", autoRefresh && "animate-pulse")} />
              {autoRefresh ? "LIVE" : "PAUSED"}
            </div>
            <span className="text-sm text-muted-foreground">
              {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setAutoRefresh((x) => !x)}>
              {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span className="ml-1.5 text-xs">{autoRefresh ? "Pause" : "Resume"}</span>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/rack-console"><ExternalLink className="h-3.5 w-3.5" /><span className="ml-1.5 text-xs">Rack Console</span></Link>
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
          <Kpi icon={<Dumbbell className="h-3.5 w-3.5" />} label="Active Racks" value={activeSessions.length} />
          <Kpi icon={<Users className="h-3.5 w-3.5" />} label="Training Now" value={trainingAthleteIds.size} />
          <Kpi icon={<Activity className="h-3.5 w-3.5" />} label="Sets Logged" value={totalLogs} />
          <Kpi icon={<Flame className="h-3.5 w-3.5 text-orange-500" />} label="PRs Today" value={prs} tone="pr" />
          <Kpi icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />} label="Flagged" value={flagged} tone="warn" />
          <Kpi icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />} label="Finished" value={completedSessions} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Rack floor */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Rack Floor</h2>
            <span className="text-xs text-muted-foreground">{activeSessions.length} active</span>
          </div>
          {activeSessions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
                <Dumbbell className="h-8 w-8 opacity-30" />
                <p className="text-sm">No active rack sessions today.</p>
                <Button size="sm" variant="outline" asChild className="mt-2">
                  <Link to="/rack-console">Open Rack Console</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {activeSessions.map((s) => (
                <RackCard
                  key={s.id}
                  session={s}
                  team={teamById.get(s.team_id) ?? null}
                  workout={s.workout_id ? workoutById.get(s.workout_id) ?? null : null}
                  athletes={rsAthletes.filter((r) => r.rack_session_id === s.id)}
                  athleteById={athleteById}
                  workoutById={workoutById}
                  exercisesByWorkout={exercisesByWorkout}
                  exerciseById={exerciseById}
                  setsByExercise={setsByExercise}
                  logsByAthlete={logsByAthlete}
                  now={now}
                />
              ))}
            </div>
          )}
        </div>

        {/* Activity rail */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Live Activity</h2>
            <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", autoRefresh && "animate-spin-slow")} />
          </div>
          <Card className="max-h-[70vh] overflow-hidden">
            <CardContent className="max-h-[70vh] overflow-y-auto p-0">
              {setLogs.length === 0 ? (
                <div className="py-10 text-center text-xs text-muted-foreground">No activity yet.</div>
              ) : (
                <ul className="divide-y divide-border/40">
                  {setLogs.slice(0, 40).map((l) => {
                    const a = athleteById.get(l.athlete_id);
                    const e = exerciseById.get(l.workout_exercise_id);
                    const age = now - new Date(l.completed_at).getTime();
                    const fresh = age < JUST_LOGGED_MS;
                    const isPr = l.override_status === "pr" || l.review_reason === "pr";
                    const isFlag = l.approval_status === "pending_review" || l.validation_status === "flagged";
                    return (
                      <li
                        key={l.id}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 text-xs transition-colors",
                          fresh && "bg-primary/5",
                          fresh && isPr && "bg-emerald-500/10",
                          fresh && isFlag && "bg-amber-500/10",
                        )}
                      >
                        <Avatar name={a ? athleteDisplayName(a) : "?"} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">
                            {a ? athleteDisplayName(a) : "Unknown"}
                            {isPr && <span className="ml-1.5 text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400">PR</span>}
                            {isFlag && <span className="ml-1.5 text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">FLAG</span>}
                          </div>
                          <div className="truncate text-muted-foreground">
                            {e?.exercise_name ?? "—"}
                            {l.load != null && ` · ${l.load}lb`}
                            {l.reps != null && ` × ${l.reps}`}
                            {l.avg_velocity != null && ` · ${l.avg_velocity.toFixed(2)}m/s`}
                          </div>
                        </div>
                        <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
                          {timeAgo(l.completed_at, now)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------- KPI ----------
function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone?: "pr" | "warn" }) {
  return (
    <div className={cn(
      "flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2",
      tone === "pr" && "border-emerald-500/30 bg-emerald-500/5",
      tone === "warn" && value > 0 && "border-amber-500/30 bg-amber-500/5",
    )}>
      <div className="text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <div className="text-lg font-semibold leading-none tabular-nums">{value}</div>
        <div className="mt-0.5 truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

// ---------- Avatar ----------
function Avatar({ name, color, size = "md" }: { name: string; color?: string | null; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold text-white", dim)}
      style={{ backgroundColor: color || "hsl(var(--primary))" }}
    >
      {initials(name)}
    </div>
  );
}

// ---------- RackCard ----------
type RackCardProps = {
  session: RackSession;
  team: Team | null;
  workout: Workout | null;
  athletes: RackSessionAthlete[];
  athleteById: Map<string, Athlete>;
  workoutById: Map<string, Workout>;
  exercisesByWorkout: Map<string, WorkoutExercise[]>;
  exerciseById: Map<string, WorkoutExercise>;
  setsByExercise: Map<string, WorkoutSet[]>;
  logsByAthlete: Map<string, RackSetLog[]>;
  now: number;
};

function RackCard({
  session, team, workout, athletes, athleteById, workoutById,
  exercisesByWorkout, exerciseById, setsByExercise, logsByAthlete, now,
}: RackCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-1 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold text-white"
              style={{ backgroundColor: team?.color || "hsl(var(--primary))" }}
            >
              {session.rack_number}
            </span>
            <div className="min-w-0">
              <CardTitle className="truncate text-sm font-semibold">
                Rack {session.rack_number}
              </CardTitle>
              <div className="truncate text-[11px] text-muted-foreground">
                {team?.name ?? "—"}
              </div>
            </div>
          </div>
          <Button size="sm" variant="ghost" asChild className="h-7 px-2 text-xs">
            <Link to="/rack-console" search={{ session: session.id } as never}>
              Open
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {athletes.length === 0 ? (
          <div className="py-3 text-center text-xs text-muted-foreground">No athletes assigned</div>
        ) : (
          athletes.sort((a, b) => a.quadrant - b.quadrant).map((rsa) => {
            const athlete = athleteById.get(rsa.athlete_id);
            const activeWorkoutId = rsa.active_workout_id ?? rsa.assigned_workout_id ?? session.workout_id;
            const w = activeWorkoutId ? workoutById.get(activeWorkoutId) ?? workout : workout;
            const exList = activeWorkoutId ? exercisesByWorkout.get(activeWorkoutId) ?? [] : [];
            const logs = logsByAthlete.get(rsa.athlete_id) ?? [];

            // total prescribed sets across the workout
            let totalSets = 0;
            for (const ex of exList) {
              const s = setsByExercise.get(ex.id);
              totalSets += s?.length ?? ex.sets ?? 0;
            }
            const completed = logs.filter((l) => l.status === "completed").length;
            const pct = totalSets > 0 ? Math.round((completed / totalSets) * 100) : 0;

            // current exercise = last logged exercise's group, or next unlogged
            const lastLog = logs[logs.length - 1];
            const currentEx = lastLog ? exerciseById.get(lastLog.workout_exercise_id) : exList[0];
            const currentExSets = currentEx ? setsByExercise.get(currentEx.id) ?? [] : [];
            const setsForCurrentEx = currentEx ? logs.filter((l) => l.workout_exercise_id === currentEx.id).length : 0;
            const targetForCurrentEx = currentExSets.length || currentEx?.sets || 0;

            // just-logged pulse
            const freshLog = logs.find((l) => now - new Date(l.completed_at).getTime() < JUST_LOGGED_MS);
            const freshKind = freshLog
              ? (freshLog.override_status === "pr" || freshLog.review_reason === "pr" ? "pr"
                : freshLog.approval_status === "pending_review" || freshLog.validation_status === "flagged" ? "flag"
                : "set")
              : null;

            return (
              <div
                key={rsa.id}
                className={cn(
                  "relative flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 p-2 transition-colors",
                  freshKind === "pr" && "border-emerald-500/50 bg-emerald-500/10",
                  freshKind === "flag" && "border-amber-500/50 bg-amber-500/10",
                  freshKind === "set" && "border-primary/40 bg-primary/5",
                )}
              >
                {freshKind && (
                  <span className={cn(
                    "absolute right-2 top-1 text-[9px] font-bold uppercase tracking-wide",
                    freshKind === "pr" && "text-emerald-600 dark:text-emerald-400",
                    freshKind === "flag" && "text-amber-600 dark:text-amber-400",
                    freshKind === "set" && "text-primary",
                  )}>
                    {freshKind === "pr" ? "PR!" : freshKind === "flag" ? "REVIEW" : "LOGGED"}
                  </span>
                )}
                <Avatar name={athlete ? athleteDisplayName(athlete) : "?"} color={team?.color} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="truncate text-xs font-medium">
                      {athlete ? athleteDisplayName(athlete) : "Unknown"}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{pct}%</span>
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {currentEx?.exercise_name ?? w?.name ?? "—"}
                    {targetForCurrentEx > 0 && (
                      <span className="ml-1 tabular-nums">· set {Math.min(setsForCurrentEx + 1, targetForCurrentEx)}/{targetForCurrentEx}</span>
                    )}
                    {lastLog?.load != null && (
                      <span className="ml-1 tabular-nums">· {lastLog.load}lb×{lastLog.reps ?? "—"}</span>
                    )}
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-border/60">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${pct}%`, backgroundColor: pct === 100 ? "hsl(var(--chart-2, 142 71% 45%))" : undefined }}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
