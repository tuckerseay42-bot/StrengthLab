import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dumbbell, Play, RotateCcw, CheckCircle2, Clock, ListChecks, MessageSquare, Layers } from "lucide-react";
import {
  programsQO, programPhasesQO, programCyclesQO, programSessionsQO,
  type Program, type ProgramPhase, type ProgramCycle, type ProgramSession,
} from "@/lib/queries";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Props = { athleteId: string; programId: string | null };

export function TodaysLiftCard({ athleteId, programId }: Props) {
  // Today's rack assignment → workoutId
  const { data: assignment } = useQuery({
    queryKey: ["todays-lift-assignment", athleteId],
    queryFn: async () => {
      const today = todayISO();
      const { data, error } = await supabase.from("rack_session_athletes")
        .select("id, assigned_workout_id, active_workout_id, rack_sessions!inner(id, session_date, status, workout_id)")
        .eq("athlete_id", athleteId)
        .eq("rack_sessions.session_date", today)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 30000,
  });

  const rackSession = (assignment as unknown as { rack_sessions?: { id: string; session_date: string; status: string; workout_id: string | null } })?.rack_sessions;

  // Fallback: coach-scheduled assignment for the athlete or one of their teams.
  const { data: assignedWorkoutId = null } = useQuery({
    queryKey: ["todays-lift-scheduled", athleteId],
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

  const workoutId = assignment?.active_workout_id || assignment?.assigned_workout_id || rackSession?.workout_id || assignedWorkoutId || null;


  const { data: workout } = useQuery({
    queryKey: ["todays-lift-workout", workoutId],
    enabled: !!workoutId,
    queryFn: async () => {
      const { data, error } = await supabase.from("workouts")
        .select("id, name, notes, description")
        .eq("id", workoutId!).maybeSingle();
      if (error) throw error;
      return data as unknown as { id: string; name: string; notes: string | null; description: string | null } | null;
    },
  });

  const { data: exercises = [] } = useQuery({
    queryKey: ["todays-lift-exercises", workoutId],
    enabled: !!workoutId,
    queryFn: async () => {
      const { data, error } = await supabase.from("workout_exercises")
        .select("id, sets").eq("workout_id", workoutId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const exerciseIds = exercises.map((e) => e.id);
  const { data: setPrescriptions = [] } = useQuery({
    queryKey: ["todays-lift-sets", exerciseIds],
    enabled: exerciseIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("workout_sets")
        .select("id, workout_exercise_id, sets").in("workout_exercise_id", exerciseIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["todays-lift-logs", athleteId, rackSession?.id],
    enabled: !!rackSession,
    queryFn: async () => {
      const { data, error } = await supabase.from("rack_set_logs")
        .select("id, status")
        .eq("athlete_id", athleteId).eq("rack_session_id", rackSession!.id);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 20000,
  });

  // Program hierarchy for context
  const { data: programs = [] } = useQuery(programsQO);
  const { data: phases = [] } = useQuery({ ...programPhasesQO(programId ?? ""), enabled: !!programId });
  const { data: cycles = [] } = useQuery({ ...programCyclesQO(programId ?? ""), enabled: !!programId });
  const { data: sessions = [] } = useQuery({ ...programSessionsQO(programId ?? ""), enabled: !!programId });

  const program: Program | undefined = programs.find((p) => p.id === programId);
  const programSession: ProgramSession | undefined = useMemo(() => {
    if (!workoutId) return undefined;
    const today = todayISO();
    return sessions.find((s) => s.workout_id === workoutId && s.scheduled_date === today)
      ?? sessions.find((s) => s.workout_id === workoutId);
  }, [sessions, workoutId]);
  const cycle: ProgramCycle | undefined = programSession ? cycles.find((c) => c.id === programSession.cycle_id) : undefined;
  const phase: ProgramPhase | undefined = programSession ? phases.find((p) => p.id === programSession.phase_id) : undefined;

  // Progress
  const totalSets = useMemo(() => {
    if (setPrescriptions.length > 0) {
      return setPrescriptions.reduce((n, p) => n + Math.max(1, Number((p as { sets?: number | null }).sets ?? 1) || 1), 0);
    }
    return exercises.reduce((n, e) => n + (e.sets ?? 1), 0);
  }, [exercises, setPrescriptions]);
  const completedSets = logs.filter((l) => l.status === "completed").length;
  const pct = totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;
  const isComplete = totalSets > 0 && completedSets >= totalSets;
  const isStarted = completedSets > 0;

  // No workout state
  if (!workoutId) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center">
          <Dumbbell className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-2 text-base font-semibold">No workout assigned today.</div>
          <p className="mt-1 text-sm text-muted-foreground">If this looks incorrect, contact your coach.</p>
        </CardContent>
      </Card>
    );
  }

  const ctaLabel = isComplete ? "Review Today's Workout" : isStarted ? "Resume Workout" : "Start Workout";
  const CtaIcon = isComplete ? CheckCircle2 : isStarted ? RotateCcw : Play;

  const bars = 20;
  const filled = Math.round((pct / 100) * bars);

  // Estimated time: prefer workout.estimated_duration_min, else totalSets * 2 min heuristic
  const estMin = totalSets > 0 ? Math.max(15, totalSets * 2) : null;

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card shadow-[0_10px_40px_-15px_rgba(59,130,246,0.35)]">
        <CardContent className="space-y-4 p-5 sm:p-6">
          {/* Eyebrow / hierarchy */}
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <span className="text-primary">Today's Lift</span>
            {program && <><span>·</span><span>{program.name}</span></>}
            {phase && <><span>·</span><span>{phase.name}</span></>}
            {cycle && <><span>·</span><span>{cycle.name}</span></>}
            {programSession && <><span>·</span><span>Week {programSession.week} · Day {programSession.day}</span></>}
          </div>

          {/* Title */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                {workout?.name ?? "Today's session"}
              </h2>
              {workout?.description && (
                <div className="mt-0.5 text-sm text-muted-foreground">{workout.description}</div>
              )}
            </div>
            {isComplete ? (
              <Badge className="shrink-0 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">Complete</Badge>
            ) : isStarted ? (
              <Badge variant="secondary" className="shrink-0">In progress</Badge>
            ) : (
              <Badge variant="outline" className="shrink-0">Ready</Badge>
            )}
          </div>

          {/* Progress */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Today's Progress</span>
              <span className="text-sm font-semibold tabular-nums">{pct}%</span>
            </div>
            <div className="font-mono text-[11px] leading-none text-primary/70 select-none" aria-hidden>
              {"█".repeat(filled)}<span className="text-muted-foreground/40">{"░".repeat(bars - filled)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {completedSets} of {totalSets || "?"} sets completed
            </div>
          </div>

          {/* Coach notes */}
          {workout?.notes && (
            <div className="rounded-md border border-border/60 bg-muted/40 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <MessageSquare className="h-3 w-3" /> Coach notes
              </div>
              <p className="text-sm text-foreground/90">{workout.notes}</p>
            </div>
          )}

          {/* CTA */}
          <Button asChild size="lg" className="h-14 w-full text-base font-semibold">
            <Link to="/athlete/today">
              <CtaIcon className="mr-2 h-5 w-5" /> {ctaLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile icon={<Clock className="h-4 w-4" />} label="Est. Time" value={estMin ? `${estMin} min` : "—"} />
        <StatTile icon={<Layers className="h-4 w-4" />} label="Exercises" value={String(exercises.length)} />
        <StatTile icon={<ListChecks className="h-4 w-4" />} label="Total Sets" value={String(totalSets || "—")} />
        <StatTile icon={<MessageSquare className="h-4 w-4" />} label="Coach Notes" value={workout?.notes ? "Available" : "None"} />
      </div>
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
