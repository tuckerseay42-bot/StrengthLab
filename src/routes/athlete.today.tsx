import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dumbbell, Trophy, Timer, CheckCircle2, Flame, Calendar, ArrowLeft, Sparkles, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toUserMessage } from "@/lib/db-errors";
import { suggestLoad } from "@/lib/prescription";
import { DEFAULT_1RM_FORMULA, isOneRmFormula, type OneRmFormula } from "@/lib/one-rm";
import { titleCaseName } from "@/lib/queries";
import type { RepMax, WorkoutExercise, WorkoutSet } from "@/lib/queries";

export const Route = createFileRoute("/athlete/today")({
  head: () => ({ meta: [
    { title: "Today — Athlete" },
    { name: "robots", content: "noindex" },
  ] }),
  component: AthleteToday,
});

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function AthleteToday() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Resolve athlete for signed-in user
  const { data: athlete } = useQuery({
    queryKey: ["me-athlete", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("athletes")
        .select("id, name, first_name, last_name, team_id, organization_id, program_id")
        .eq("user_id", userId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (userId === undefined) {
    return <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>;
  }
  if (!userId) {
    return (
      <Card><CardContent className="space-y-3 p-8 text-center">
        <div className="text-sm text-muted-foreground">Sign in to see today's session.</div>
        <Button onClick={() => navigate({ to: "/auth" })}>Sign in</Button>
      </CardContent></Card>
    );
  }
  if (!athlete) {
    return (
      <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
        Your account isn't linked to an athlete profile yet. Ask your coach for a join link.
      </CardContent></Card>
    );
  }

  return <TodayView athleteId={athlete.id} athleteName={titleCaseName(athlete.first_name || athlete.name)} programId={athlete.program_id} organizationId={athlete.organization_id} />;
}

/* ---- Set expansion (pure — reused for every exercise) ---- */
type Prescription = { id: string; workout_exercise_id: string; position: number; sets: number | null; reps: string | null; load: number | null; percent: number | null; percent_of_exercise_id: string | null; rm_reps: number | null };
type Log = { id: string; workout_exercise_id: string; set_position: number; load: number | null; reps: number | null; avg_velocity: number | null; rpe: number | null; status: string; completed_at: string | null; estimated_1rm: number | null };
type ExerciseRow = { id: string; exercise_id: string | null; exercise_name: string; sets: number | null; reps: string | null; load: number | null; percent: number | null; percent_of_exercise_id: string | null; tempo: string | null; notes: string | null; target_velocity_min: number | null; target_velocity_max: number | null };
type PlannedSet = { position: number; prescribedLoad: number | null; prescribedReps: string | null; percent: number | null };

function buildSetList(
  exercise: ExerciseRow, prescriptions: Prescription[], athleteId: string,
  repMaxes: RepMax[], referenceExercises: { id: string; name: string }[], formula: OneRmFormula,
): PlannedSet[] {
  if (prescriptions.length > 0) {
    const sorted = [...prescriptions].sort((a, b) => a.position - b.position);
    const expanded: PlannedSet[] = [];
    let pos = 0;
    for (const p of sorted) {
      const count = Math.max(1, Number(p.sets ?? 1) || 1);
      for (let k = 0; k < count; k++) {
        pos += 1;
        expanded.push({
          position: pos,
          prescribedLoad: suggestLoad({
            athleteId,
            exercise: exercise as WorkoutExercise,
            setRow: p as WorkoutSet,
            repMaxes,
            referenceExerciseName: p.percent_of_exercise_id
              ? referenceExercises.find((e) => e.id === p.percent_of_exercise_id)?.name ?? null
              : null,
            formula,
          })?.load ?? null,
          prescribedReps: p.reps ?? exercise.reps,
          percent: p.percent,
        });
      }
    }
    return expanded;
  }
  const n = exercise.sets ?? 1;
  return Array.from({ length: n }, (_, i) => ({
    position: i + 1, prescribedLoad: exercise.load, prescribedReps: exercise.reps, percent: exercise.percent,
  }));
}

export function TodayView({ athleteId, athleteName, programId, organizationId }: {
  athleteId: string; athleteName: string; programId: string | null; organizationId?: string;
}) {
  const qc = useQueryClient();

  // Today's rack assignment
  const { data: assignment } = useQuery({
    queryKey: ["athlete-today-assignment", athleteId],
    queryFn: async () => {
      const today = todayISO();
      const { data, error } = await supabase.from("rack_session_athletes")
        .select("id, rack_session_id, assigned_workout_id, active_workout_id, opened_at, rack_sessions!inner(id, session_date, status, workout_id, rack_number, team_id)")
        .eq("athlete_id", athleteId)
        .eq("rack_sessions.session_date", today)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 30000,
  });

  const rackSession = (assignment as unknown as { rack_sessions?: { id: string; session_date: string; status: string; workout_id: string | null; rack_number: number; team_id: string } })?.rack_sessions;

  // Fallback: coach-scheduled assignment for the athlete or one of their teams.
  const { data: assignedWorkoutId = null } = useQuery({
    queryKey: ["athlete-today-scheduled", athleteId],
    refetchInterval: 60000,
    queryFn: async () => {
      const today = todayISO();
      const [{ data: athleteRow }, { data: memberships }] = await Promise.all([
        supabase.from("athletes").select("team_id").eq("id", athleteId).maybeSingle(),
        supabase.from("athlete_teams").select("team_id").eq("athlete_id", athleteId),
      ]);
      const teamIds = Array.from(new Set([
        ...(athleteRow?.team_id ? [athleteRow.team_id] : []),
        ...((memberships ?? []).map((m) => m.team_id)),
      ]));
      const { data: direct } = await supabase.from("workout_assignments")
        .select("workout_id").eq("athlete_id", athleteId).eq("scheduled_date", today).limit(1);
      if (direct?.[0]) return direct[0].workout_id as string;
      if (teamIds.length > 0) {
        const { data: team } = await supabase.from("workout_assignments")
          .select("workout_id").in("team_id", teamIds).eq("scheduled_date", today).limit(1);
        if (team?.[0]) return team[0].workout_id as string;
      }
      return null;
    },
  });

  const candidateWorkoutId = assignment?.active_workout_id || assignment?.assigned_workout_id || rackSession?.workout_id || assignedWorkoutId || null;


  // Athletes only see workouts that belong to a program. A one-off workout
  // that was never attached to a program stays hidden on Training View.
  const { data: inProgram, isLoading: programCheckLoading } = useQuery({
    queryKey: ["today-workout-in-program", candidateWorkoutId],
    enabled: !!candidateWorkoutId,
    queryFn: async () => {
      const [sessions, links] = await Promise.all([
        supabase.from("program_sessions" as never)
          .select("id").eq("workout_id", candidateWorkoutId!).limit(1),
        supabase.from("program_workouts")
          .select("id").eq("workout_id", candidateWorkoutId!).limit(1),
      ]);
      if (sessions.error) throw sessions.error;
      if (links.error) throw links.error;
      return ((sessions.data as unknown as unknown[])?.length ?? 0) > 0 || (links.data?.length ?? 0) > 0;
    },
  });

  const workoutId = candidateWorkoutId && inProgram ? candidateWorkoutId : null;
  const hiddenUnprogrammed = !!candidateWorkoutId && !programCheckLoading && inProgram === false;

  // Exercises for that workout
  const { data: exercises = [] } = useQuery({
    queryKey: ["today-workout-exercises", workoutId],
    enabled: !!workoutId,
    queryFn: async () => {
      const { data, error } = await supabase.from("workout_exercises")
        .select("id, exercise_id, exercise_name, position, sets, reps, load, percent, percent_of_exercise_id, tempo, notes, target_velocity_min, target_velocity_max")
        .eq("workout_id", workoutId!).order("position");
      if (error) throw error;
      return data ?? [];
    },
  });


  const exerciseIds = exercises.map((e) => e.id);
  const { data: setPrescriptions = [] } = useQuery({
    queryKey: ["today-workout-sets", exerciseIds],
    enabled: exerciseIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("workout_sets")
        .select("id, workout_exercise_id, position, sets, reps, load, percent, percent_of_exercise_id, rm_reps")
        .in("workout_exercise_id", exerciseIds).order("position");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: repMaxData = [] } = useQuery({
    queryKey: ["athlete-today-rep-maxes", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("rep_maxes").select("*").eq("athlete_id", athleteId);
      if (error) throw error;
      return (data ?? []) as RepMax[];
    },
  });
  const { data: formula = DEFAULT_1RM_FORMULA } = useQuery({
    queryKey: ["athlete-today-1rm-formula", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<OneRmFormula> => {
      const { data } = await supabase.from("organizations").select("default_1rm_formula").eq("id", organizationId!).maybeSingle();
      return isOneRmFormula(data?.default_1rm_formula) ? data.default_1rm_formula : DEFAULT_1RM_FORMULA;
    },
  });
  const referenceIds = Array.from(new Set([
    ...exercises.map((e) => e.percent_of_exercise_id),
    ...setPrescriptions.map((s) => s.percent_of_exercise_id),
  ].filter((id): id is string => !!id)));
  const { data: referenceExercises = [] } = useQuery({
    queryKey: ["athlete-today-reference-exercises", referenceIds],
    enabled: referenceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("exercises").select("id, name").in("id", referenceIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Today's logs
  const { data: logs = [] } = useQuery({
    queryKey: ["today-logs", athleteId, rackSession?.id],
    enabled: !!rackSession,
    queryFn: async () => {
      const { data, error } = await supabase.from("rack_set_logs")
        .select("id, workout_exercise_id, set_position, load, reps, avg_velocity, rpe, status, completed_at, estimated_1rm")
        .eq("athlete_id", athleteId).eq("rack_session_id", rackSession!.id)
        .order("completed_at");
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15000,
  });

  // Realtime updates for logs
  useEffect(() => {
    if (!rackSession) return;
    const ch = supabase.channel(`athlete-today-${athleteId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rack_set_logs", filter: `athlete_id=eq.${athleteId}` },
        () => qc.invalidateQueries({ queryKey: ["today-logs", athleteId, rackSession.id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [athleteId, rackSession, qc]);

  // Heartbeat: mark when this athlete opened today's session, then keep
  // last_seen_at fresh while the tab stays open, so the coach's Command
  // Center can tell "opened", "still here", and "opened but never logged"
  // apart in real time.
  const assignmentId = assignment?.id ?? null;
  const alreadyOpened = !!assignment?.opened_at;
  useEffect(() => {
    if (!assignmentId) return;
    const ping = (first: boolean) => {
      const nowISO = new Date().toISOString();
      const payload: { last_seen_at: string; opened_at?: string } = { last_seen_at: nowISO };
      if (first && !alreadyOpened) payload.opened_at = nowISO;
      void supabase.from("rack_session_athletes").update(payload).eq("id", assignmentId);
    };
    ping(true);
    const onVisible = () => { if (document.visibilityState === "visible") ping(false); };
    const id = window.setInterval(onVisible, 45_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [assignmentId, alreadyOpened]);

  // Recent PRs
  const { data: recentPRs = [] } = useQuery({
    queryKey: ["athlete-recent-prs", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("rep_maxes")
        .select("id, exercise_name, reps, load, tested_at")
        .eq("athlete_id", athleteId).order("tested_at", { ascending: false }).limit(6);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Upcoming week (program_sessions)
  const { data: upcoming = [] } = useQuery({
    queryKey: ["athlete-upcoming", programId],
    enabled: !!programId,
    queryFn: async () => {
      const today = todayISO();
      const in7 = new Date(); in7.setDate(in7.getDate() + 7);
      const end = `${in7.getFullYear()}-${String(in7.getMonth() + 1).padStart(2, "0")}-${String(in7.getDate()).padStart(2, "0")}`;
      const { data, error } = await supabase.from("program_sessions" as never)
        .select("id, name, scheduled_date, week, day")
        .eq("program_id", programId!).gte("scheduled_date", today).lte("scheduled_date", end)
        .order("scheduled_date");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; name: string; scheduled_date: string; week: number; day: number }[];
    },
  });

  // One row per exercise: its planned sets, its logs, and whether it's done —
  // the shared basis for the progress bar, the "up now" card, and the lineup.
  const perExercise = useMemo(() => {
    return exercises.map((ex) => {
      const prescriptions = setPrescriptions.filter((s) => s.workout_exercise_id === ex.id);
      const exLogs = logs.filter((l) => l.workout_exercise_id === ex.id);
      const setList = buildSetList(ex, prescriptions, athleteId, repMaxData, referenceExercises, formula);
      const completedCount = exLogs.length;
      return { exercise: ex, setList, logs: exLogs, completedCount, totalCount: setList.length, isDone: setList.length > 0 && completedCount >= setList.length };
    });
  }, [exercises, setPrescriptions, logs, athleteId, repMaxData, referenceExercises, formula]);

  // Which exercise is "up now" — the first one with sets left, unless the
  // athlete tapped ahead in the lineup to look at something else.
  const [manualFocusId, setManualFocusId] = useState<string | null>(null);
  const autoFocus = perExercise.find((pe) => !pe.isDone) ?? perExercise.at(-1) ?? null;
  const focused = (manualFocusId ? perExercise.find((pe) => pe.exercise.id === manualFocusId) : null) ?? autoFocus;
  useEffect(() => {
    // Release a manual look-ahead once that exercise is finished, so focus
    // returns to whatever's actually next.
    if (manualFocusId && perExercise.find((pe) => pe.exercise.id === manualFocusId)?.isDone) {
      setManualFocusId(null);
    }
  }, [perExercise, manualFocusId]);

  // Progress
  const totalSets = perExercise.reduce((n, pe) => n + pe.totalCount, 0);
  const completedSets = perExercise.reduce((n, pe) => n + pe.completedCount, 0);
  const pct = totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;
  const anyPR = logs.some((l) => l.estimated_1rm && l.completed_at && new Date(l.completed_at).toDateString() === new Date().toDateString());
  const allDone = perExercise.length > 0 && perExercise.every((pe) => pe.isDone);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild size="sm" variant="ghost"><Link to="/athlete"><ArrowLeft className="h-4 w-4" /> Dashboard</Link></Button>
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Today, {athleteName}</h1>
            <p className="text-sm text-muted-foreground">
              {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
        </div>
        {rackSession && (
          <div className="flex items-center gap-2">
            <Badge variant="outline"><Dumbbell className="mr-1 h-3 w-3" />Rack {rackSession.rack_number}</Badge>
            <Badge variant={rackSession.status === "active" ? "default" : "secondary"}>{rackSession.status}</Badge>
          </div>
        )}
      </div>

      {/* PR banner */}
      {anyPR && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
          <Sparkles className="h-5 w-5 text-emerald-500" />
          <div>
            <div className="font-semibold">New PR today — nice work.</div>
            <div className="text-xs text-muted-foreground">Your latest set produced an estimated one-rep max above your previous best.</div>
          </div>
        </div>
      )}

      {!workoutId ? (
        <Card><CardContent className="space-y-2 p-6 text-center">
          <div className="text-sm text-muted-foreground">
            {hiddenUnprogrammed
              ? "Today's workout hasn't been added to a program yet, so it isn't available here. Ask your coach."
              : "No session assigned for today."}
          </div>
          {upcoming[0] && (
            <div className="text-xs">
              Next up: <b>{upcoming[0].name}</b> on {upcoming[0].scheduled_date}
            </div>
          )}
        </CardContent></Card>
      ) : (
        <>
          {rackSession ? (
            <Card>
              <CardContent className="space-y-2 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{completedSets} of {totalSets || "?"} sets · {pct}%</div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <RestTimer lastCompleted={logs.filter((l) => l.status === "completed").at(-1)?.completed_at ?? null} />
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="p-4 text-sm text-muted-foreground">
                Today's workout is scheduled for you. Logging turns on once your coach opens the rack session in Training View.
              </CardContent>
            </Card>
          )}

          {perExercise.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
              No exercises loaded yet. Ask your coach if this looks wrong.
            </CardContent></Card>
          ) : allDone ? (
            <Card className="border-emerald-500/40 bg-emerald-500/5">
              <CardContent className="flex items-center gap-3 p-5">
                <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-500" />
                <div>
                  <div className="text-lg font-semibold">Workout complete — nice work!</div>
                  <div className="text-xs text-muted-foreground">Every set for today is logged.</div>
                </div>
              </CardContent>
            </Card>
          ) : focused ? (
            <FocusedExerciseCard
              athleteId={athleteId}
              rackSessionId={rackSession?.id ?? null}
              pe={focused}
              onLogged={() => qc.invalidateQueries({ queryKey: ["today-logs", athleteId, rackSession?.id] })}
            />
          ) : null}

          {perExercise.length > 1 && (
            <Card>
              <CardContent className="space-y-1.5 p-3">
                <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Today's lineup
                </div>
                {perExercise.map((pe) => (
                  <LineupRow
                    key={pe.exercise.id}
                    pe={pe}
                    isFocused={focused?.exercise.id === pe.exercise.id}
                    onSelect={() => setManualFocusId(pe.exercise.id)}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Secondary info — kept small so it never competes with the current set. */}
      {(recentPRs.length > 0 || upcoming.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardContent className="space-y-1.5 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Trophy className="h-3.5 w-3.5 text-amber-500" /> Recent PRs
              </div>
              {recentPRs.length === 0 ? (
                <div className="py-1 text-xs text-muted-foreground">No PRs yet — go get one.</div>
              ) : (
                <ul className="space-y-0.5">
                  {recentPRs.slice(0, 4).map((r) => (
                    <li key={r.id} className="flex items-center justify-between text-xs">
                      <span className="min-w-0 truncate">{r.exercise_name}</span>
                      <span className="text-muted-foreground">{r.load}×{r.reps}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1.5 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" /> Coming up this week
              </div>
              {upcoming.length === 0 ? (
                <div className="py-1 text-xs text-muted-foreground">Nothing scheduled.</div>
              ) : (
                <ul className="space-y-0.5">
                  {upcoming.slice(0, 4).map((s) => (
                    <li key={s.id} className="flex items-center justify-between text-xs">
                      <span className="min-w-0 truncate">{s.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {new Date(s.scheduled_date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ---- Rest timer ---- */
function RestTimer({ lastCompleted }: { lastCompleted: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!lastCompleted) return null;
  const elapsed = Math.max(0, Math.floor((now - new Date(lastCompleted).getTime()) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const color = elapsed < 60 ? "text-emerald-500" : elapsed < 180 ? "text-amber-500" : "text-red-500";
  return (
    <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1"><Timer className="h-3 w-3" /> Rest since last set</span>
      <span className={`font-mono text-sm font-semibold ${color}`}>{mm}:{ss}</span>
    </div>
  );
}

/* ---- Today's lineup row — one line per exercise, tap to jump ---- */
type PerExercise = { exercise: ExerciseRow; setList: PlannedSet[]; logs: Log[]; completedCount: number; totalCount: number; isDone: boolean };

function LineupRow({ pe, isFocused, onSelect }: { pe: PerExercise; isFocused: boolean; onSelect: () => void }) {
  const { exercise, completedCount, totalCount, isDone } = pe;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors",
        isFocused ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/60",
        isDone && !isFocused && "opacity-60",
      )}
    >
      {isDone ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
      ) : isFocused ? (
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          <span className="absolute h-4 w-4 animate-ping rounded-full bg-primary/40" />
          <span className="h-2 w-2 rounded-full bg-primary" />
        </span>
      ) : (
        <span className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />
      )}
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm", isFocused ? "font-semibold" : "font-medium")}>{exercise.exercise_name}</div>
        <div className="text-[11px] text-muted-foreground">{totalCount} × {exercise.reps || "?"}</div>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{completedCount}/{totalCount}</span>
    </button>
  );
}

/* ---- Up-now card: the one exercise the athlete should be doing ---- */
function FocusedExerciseCard({ athleteId, rackSessionId, pe, onLogged }: {
  athleteId: string; rackSessionId: string | null; pe: PerExercise; onLogged: () => void;
}) {
  const { exercise, setList, logs } = pe;
  const firstOpen = setList.find((s) => !logs.some((l) => l.set_position === s.position))?.position ?? setList.at(-1)?.position ?? 1;
  const [activePos, setActivePos] = useState(firstOpen);
  useEffect(() => { setActivePos(firstOpen); }, [exercise.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = setList.find((s) => s.position === activePos) ?? setList[0];
  const activeLog = logs.find((l) => l.set_position === activePos);

  return (
    <Card className="overflow-hidden border-primary/30">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Up now</div>
            <div className="truncate text-xl font-bold sm:text-2xl">{exercise.exercise_name}</div>
            <div className="text-xs text-muted-foreground">
              {setList.length} × {exercise.reps || "?"} {exercise.tempo && `· tempo ${exercise.tempo}`}
              {exercise.target_velocity_min && ` · target ${exercise.target_velocity_min}${exercise.target_velocity_max ? `–${exercise.target_velocity_max}` : ""} m/s`}
            </div>
            {exercise.notes && <div className="mt-1 text-xs text-muted-foreground">{exercise.notes}</div>}
          </div>
          <Badge variant={pe.completedCount >= setList.length ? "default" : "secondary"} className="shrink-0">
            {pe.completedCount}/{setList.length}
          </Badge>
        </div>

        {/* Set pills — tap any set to bring it up below */}
        <div className="flex flex-wrap gap-1.5">
          {setList.map((s) => {
            const done = logs.some((l) => l.set_position === s.position);
            const isActive = s.position === activePos;
            return (
              <button
                key={s.position}
                type="button"
                onClick={() => setActivePos(s.position)}
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : done
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                      : "border-muted-foreground/25 text-muted-foreground",
                )}
              >
                {s.position}
              </button>
            );
          })}
        </div>

        {active && (
          <SetEntry
            key={active.position}
            athleteId={athleteId}
            rackSessionId={rackSessionId}
            exerciseId={exercise.id}
            position={active.position}
            prescribedLoad={active.prescribedLoad}
            prescribedReps={active.prescribedReps}
            existing={activeLog}
            targetVMin={exercise.target_velocity_min}
            targetVMax={exercise.target_velocity_max}
            onLogged={(loggedPos) => {
              onLogged();
              const next = setList.find((s) => s.position === loggedPos + 1);
              if (next) setActivePos(next.position);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

/* ---- Big single-set entry ---- */
function SetEntry({ athleteId, rackSessionId, exerciseId, position, prescribedLoad, prescribedReps, existing, targetVMin, targetVMax, onLogged }: {
  athleteId: string; rackSessionId: string | null; exerciseId: string; position: number;
  prescribedLoad: number | null; prescribedReps: string | null;
  existing?: Log; targetVMin: number | null; targetVMax: number | null;
  onLogged: (position: number) => void;
}) {
  const [load, setLoad] = useState<string>(existing?.load?.toString() ?? prescribedLoad?.toString() ?? "");
  const [reps, setReps] = useState<string>(existing?.reps?.toString() ?? (prescribedReps ?? "").replace(/\D/g, ""));
  const [vel, setVel] = useState<string>(existing?.avg_velocity?.toString() ?? "");
  const [rpe, setRpe] = useState<string>(existing?.rpe?.toString() ?? "");
  const [showMore, setShowMore] = useState(targetVMin != null || !!existing?.avg_velocity || !!existing?.rpe);

  const save = useMutation({
    mutationFn: async () => {
      if (!rackSessionId) throw new Error("Your coach hasn't opened today's rack session yet.");
      const payload = {
        athlete_id: athleteId, rack_session_id: rackSessionId,
        workout_exercise_id: exerciseId, set_position: position,
        load: load ? Number(load) : null, reps: reps ? parseInt(reps) : null,
        avg_velocity: vel ? Number(vel) : null, rpe: rpe ? Number(rpe) : null,
        status: "completed", completed_at: new Date().toISOString(),
      };
      if (existing) {
        const { error } = await supabase.from("rack_set_logs").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("rack_set_logs").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success(`Set ${position} logged`); onLogged(position); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const done = existing?.status === "completed";
  const velNum = Number(vel);
  const velOk = !vel || !targetVMin || (velNum >= targetVMin && (!targetVMax || velNum <= targetVMax));

  return (
    <div className={cn("space-y-3 rounded-lg border bg-muted/30 p-3", done && "border-emerald-500/40 bg-emerald-500/5")}>
      <div className="text-sm font-semibold text-muted-foreground">Set {position}</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-[11px] text-muted-foreground">Weight (lb)</Label>
          <Input
            className="h-16 text-center text-3xl font-bold tabular-nums"
            inputMode="decimal" placeholder="0" value={load} onChange={(e) => setLoad(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Reps</Label>
          <Input
            className="h-16 text-center text-3xl font-bold tabular-nums"
            inputMode="numeric" placeholder="0" value={reps} onChange={(e) => setReps(e.target.value)}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground"
      >
        {showMore ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Velocity &amp; RPE
      </button>
      {showMore && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[11px] text-muted-foreground">Velocity (m/s)</Label>
            <Input className={cn("h-11", !velOk && "border-amber-500")} inputMode="decimal" placeholder="—" value={vel} onChange={(e) => setVel(e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">RPE</Label>
            <Input className="h-11" inputMode="decimal" placeholder="—" value={rpe} onChange={(e) => setRpe(e.target.value)} />
          </div>
        </div>
      )}

      <Button
        size="lg"
        variant={done ? "outline" : "default"}
        className="h-14 w-full text-lg"
        onClick={() => save.mutate()}
        disabled={save.isPending || !rackSessionId}
      >
        {save.isPending
          ? "Saving…"
          : done
            ? <><Flame className="h-5 w-5" /> Re-log set {position}</>
            : <><CheckCircle2 className="h-5 w-5" /> Log set {position}</>}
      </Button>
    </div>
  );
}
