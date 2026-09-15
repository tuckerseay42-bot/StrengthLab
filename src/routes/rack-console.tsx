import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  athletesQO,
  teamsQO,
  workoutsQO,
  workoutExercisesQO,
  workoutSetsQO,
  programsQO,
  programWorkoutsQO,
  repMaxesQO,
  exercisesQO,
  athleteDisplayName,
  workoutAssignmentsQO,
  athleteTeamsQO,
  programPhasesQO,
  programCyclesQO,
  programSessionsQO,
  type Athlete,
  type Team,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
  type RepMax,
  type Program,
} from "@/lib/queries";
import { resolveAthleteWorkout } from "@/lib/training-resolver";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RackAssignmentBoard } from "@/components/rack-assignment-board";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import {
  Search,
  X,
  Maximize2,
  Minimize2,
  Users,
  Grid2X2,
  Grid3X3,
  LayoutGrid,
  Check,
  MoreVertical,
  Trophy,
  StickyNote,
  RotateCcw,
  ArrowRightLeft,
  UserRound,
  Rows3,
  Columns2,
  Timer,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  Layers,
  CalendarDays,
  Dumbbell,
  Star,
  History,
  BookOpen,
  Replace,
  HeartPulse,
  RotateCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { suggestLoad } from "@/lib/prescription";
import { useOrg1RMFormula } from "@/hooks/use-1rm-formula";

// ============================================================================
// Constants
// ============================================================================

const today = () => new Date().toISOString().slice(0, 10);
const RECENT_KEY = "training-view:recent-athletes";
const LAYOUT_KEY = "training-view:layout";
const RECENT_MAX = 10;
const FLASH_MS = 5000;

type LayoutSize = 2 | 4 | 6 | 8;

const LAYOUT_GRID: Record<LayoutSize, string> = {
  2: "grid-cols-2",
  4: "grid-cols-2",
  6: "grid-cols-2 md:grid-cols-3",
  8: "grid-cols-2 md:grid-cols-4",
};

const SUPERSET_ACCENT: Record<string, string> = {
  A: "bg-sky-500",
  B: "bg-amber-500",
  C: "bg-violet-500",
  D: "bg-emerald-500",
  E: "bg-pink-500",
  F: "bg-teal-500",
};

// ============================================================================
// Types
// ============================================================================

type RackSession = {
  id: string;
  team_id: string;
  rack_number: number;
  workout_id: string | null;
  session_date: string;
  athlete_ids: string[];
  active_athlete_id: string | null;
  status: string;
};

type RackSetLog = {
  id: string;
  rack_session_id: string;
  athlete_id: string;
  workout_exercise_id: string;
  set_position: number;
  load: number | null;
  reps: number | null;
  avg_velocity: number | null;
  peak_velocity: number | null;
  rpe: number | null;
  rir: number | null;
  time_seconds: number | null;
  distance_in: number | null;
  notes: string | null;
  status: string;
  completed_at: string;
  approval_status: string;
  validation_status: string;
  override_status: string | null;
  review_reason: string | null;
  rest_seconds: number | null;
};

type RackAthleteOverride = {
  id: string;
  rack_session_id: string;
  athlete_id: string;
  workout_exercise_id: string;
  substitute_exercise_id: string | null;
  substitute_exercise_name: string;
  reason: string | null;
};

type Measurement = "load" | "seconds" | "inches" | "reps" | "mph";

// Parse a sprint distance from an exercise name, returning inches or null.
// Recognizes "40y", "20 yd", "10 yard", "10m", and "15/10 fly" (uses fly leg).
function parseDistanceIn(name: string | null | undefined): number | null {
  if (!name) return null;
  const n = name.toLowerCase();
  const fly = n.match(/(\d+)\s*(?:\/\s*(\d+))?\s*fly/);
  if (fly) {
    const yd = Number(fly[2] ?? fly[1]);
    if (Number.isFinite(yd) && yd > 0) return yd * 36;
  }
  const yd = n.match(/(\d+(?:\.\d+)?)\s*(?:y|yd|yard|yards)\b/);
  if (yd) return Number(yd[1]) * 36;
  const m = n.match(/(\d+(?:\.\d+)?)\s*(?:m|meter|meters)\b/);
  if (m) return Number(m[1]) * (100 / 2.54);
  return null;
}
function mphToSeconds(mph: number, distanceIn: number): number {
  if (mph <= 0) return 0;
  const miles = distanceIn / 63360;
  return (miles / mph) * 3600;
}

// ============================================================================
// Small hooks
// ============================================================================

function useNow(interval = 1000) {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setN(Date.now()), interval);
    return () => window.clearInterval(id);
  }, [interval]);
  return n;
}

/**
 * Freeze a value for the lifetime of a "session key".
 * Prescribed loads are computed from rep maxes; logging a set writes new rep
 * maxes, which would otherwise re-price the rest of the day mid-workout.
 * We snapshot the rep maxes when the athlete's workout opens and keep them.
 */
function useFrozen<T>(value: T, key: string, ready: boolean): T {
  const ref = useRef<{ key: string; value: T; frozen: boolean } | null>(null);
  if (!ref.current || ref.current.key !== key) {
    // New session key: start pending — keep tracking `value` until ready.
    ref.current = { key, value, frozen: false };
  } else if (!ref.current.frozen) {
    // Keep refreshing until the underlying data has actually loaded, then
    // freeze. The first ready snapshot sticks; later changes (e.g. rep maxes
    // written by logging a set) don't re-price the rest of the workout.
    ref.current = { key, value, frozen: ready };
  }
  return ref.current.value;
}



function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [v, set];
}

// ============================================================================
// Route
// ============================================================================

export const Route = createFileRoute("/rack-console")({
  head: () => ({
    meta: [
      { title: "Training View — Strength Lab" },
      {
        name: "description",
        content:
          "Command center for weight room training — supervise up to eight athletes, log sets in real time, and track PRs.",
      },
    ],
  }),
  component: TrainingView,
});

// ============================================================================
// Main component
// ============================================================================

function TrainingView() {
  const qc = useQueryClient();

  // Data
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: workouts = [] } = useQuery(workoutsQO);
  const { data: workoutExercises = [] } = useQuery(workoutExercisesQO);
  const { data: workoutSets = [] } = useQuery(workoutSetsQO);
  const { data: programs = [] } = useQuery(programsQO);
  const { data: programWorkouts = [] } = useQuery(programWorkoutsQO);
  const { data: workoutAssignments = [] } = useQuery(workoutAssignmentsQO);
  const { data: athleteTeams = [] } = useQuery(athleteTeamsQO);
  const { data: repMaxes = [] } = useQuery(repMaxesQO);
  const { data: exerciseLib = [] } = useQuery(exercisesQO);

  const measurementByExId = useMemo(() => {
    const m = new Map<string, Measurement>();
    for (const e of exerciseLib) m.set(e.id, (e.measurement_type ?? "load") as Measurement);
    return m;
  }, [exerciseLib]);

  // UI state
  const [mode, setMode] = useState<"assign" | "live">("live");
  const [layoutSize, setLayoutSize] = useLocalStorage<LayoutSize>(LAYOUT_KEY, 4);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Tap-to-expand: one athlete takes over the screen so numbers are readable.
  const [focusId, setFocusId] = useState<string | null>(null);

  const [workoutByAthlete, setWorkoutByAthlete] = useState<Record<string, string | null>>({});
  const [compact, setCompact] = useState(false);
  const [rackMode, setRackMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const [recent, setRecent] = useLocalStorage<string[]>(RECENT_KEY, []);
  const [flashById, setFlashById] = useState<
    Record<string, { at: number; kind: "set" | "pr" | "flag" }>
  >({});

  // Fullscreen wiring
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  const selectedAthletes = useMemo(
    () => selectedIds.map((id) => athletes.find((a) => a.id === id)).filter(Boolean) as Athlete[],
    [selectedIds, athletes],
  );

  // Resolve assigned workouts
  const resolvedByAthlete = useMemo(() => {
    const m = new Map<string, ReturnType<typeof resolveAthleteWorkout>>();
    for (const a of selectedAthletes) {
      m.set(
        a.id,
        resolveAthleteWorkout(a, today(), {
          assignments: workoutAssignments,
          programs,
          programWorkouts,
          athleteTeams,
        }),
      );
    }
    return m;
  }, [selectedAthletes, workoutAssignments, programs, programWorkouts, athleteTeams]);

  const effectiveWorkoutFor = useCallback(
    (athleteId: string): string | null => {
      if (workoutByAthlete[athleteId] !== undefined) return workoutByAthlete[athleteId];
      return resolvedByAthlete.get(athleteId)?.workoutId ?? null;
    },
    [workoutByAthlete, resolvedByAthlete],
  );

  // Session (single row keyed on team + date)
  const sessionTeamId = selectedAthletes[0]?.team_id ?? teams[0]?.id ?? null;
  const sessionQ = useQuery({
    queryKey: ["training-view-session", sessionTeamId ?? "none", today()],
    enabled: !!sessionTeamId,
    queryFn: async (): Promise<RackSession> => {
      const { data: found, error: findErr } = await supabase
        .from("rack_sessions")
        .select("*")
        .eq("team_id", sessionTeamId!)
        .eq("rack_number", 1)
        .eq("session_date", today())
        .maybeSingle();
      if (findErr) throw findErr;
      if (found) return found as unknown as RackSession;
      const team = teams.find((t) => t.id === sessionTeamId!);
      const organization_id = team?.organization_id ?? (await getScopedOrgId());
      const { data: created, error: insErr } = await supabase
        .from("rack_sessions")
        .insert({ organization_id, team_id: sessionTeamId!, rack_number: 1, session_date: today(), athlete_ids: [] })
        .select("*")
        .single();
      if (insErr) throw insErr;
      return created as unknown as RackSession;
    },
  });
  const sessionId = sessionQ.data?.id;

  // Today's logs (for selected session + all today's logs for leader/PR calc)
  const logsQ = useQuery({
    queryKey: ["training-view-logs", sessionId ?? "none"],
    enabled: !!sessionId,
    queryFn: async (): Promise<RackSetLog[]> => {
      const { data, error } = await supabase
        .from("rack_set_logs")
        .select("*")
        .eq("rack_session_id", sessionId!);
      if (error) throw error;
      return (data ?? []) as unknown as RackSetLog[];
    },
    refetchInterval: 30_000,
  });
  const logs = logsQ.data ?? [];

  // Realtime + flash
  const prevLogIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const prev = prevLogIdsRef.current;
    const next = new Set<string>();
    const now = Date.now();
    for (const l of logs) {
      next.add(l.id);
      if (!prev.has(l.id)) {
        const kind: "pr" | "flag" | "set" =
          l.override_status === "pr" || l.review_reason === "pr"
            ? "pr"
            : l.approval_status === "pending" ||
                l.validation_status === "flagged" ||
                l.validation_status === "review"
              ? "flag"
              : "set";
        setFlashById((p) => ({ ...p, [l.athlete_id]: { at: now, kind } }));
      }
    }
    prevLogIdsRef.current = next;
  }, [logs]);
  useEffect(() => {
    if (!sessionId) return;
    const ch = supabase
      .channel(`training-view-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rack_set_logs",
          filter: `rack_session_id=eq.${sessionId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["training-view-logs", sessionId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [sessionId, qc]);

  // Per-athlete exercise substitutions for this rack session
  const overridesQ = useQuery({
    queryKey: ["training-view-overrides", sessionId ?? "none"],
    enabled: !!sessionId,
    queryFn: async (): Promise<RackAthleteOverride[]> => {
      const { data, error } = await supabase
        .from("rack_athlete_exercise_overrides")
        .select("id, rack_session_id, athlete_id, workout_exercise_id, substitute_exercise_id, substitute_exercise_name, reason")
        .eq("rack_session_id", sessionId!);
      if (error) throw error;
      return (data ?? []) as RackAthleteOverride[];
    },
  });
  const overrides = overridesQ.data ?? [];
  const overridesByAthlete = useMemo(() => {
    const m = new Map<string, Map<string, RackAthleteOverride>>();
    for (const o of overrides) {
      let am = m.get(o.athlete_id);
      if (!am) { am = new Map(); m.set(o.athlete_id, am); }
      am.set(o.workout_exercise_id, o);
    }
    return m;
  }, [overrides]);

  const swapMutation = useMutation({
    mutationFn: async (input: {
      athlete_id: string;
      workout_exercise_id: string;
      substitute_exercise_id: string | null;
      substitute_exercise_name: string;
      reason: string | null;
    }) => {
      if (!sessionId) throw new Error("No active session");
      const athlete = athletes.find((a) => a.id === input.athlete_id);
      const organization_id = athlete?.organization_id ?? (await getScopedOrgId());
      const { error } = await supabase
        .from("rack_athlete_exercise_overrides")
        .upsert(
          {
            rack_session_id: sessionId,
            athlete_id: input.athlete_id,
            workout_exercise_id: input.workout_exercise_id,
            substitute_exercise_id: input.substitute_exercise_id,
            substitute_exercise_name: input.substitute_exercise_name,
            reason: input.reason,
            organization_id,
          },
          { onConflict: "rack_session_id,athlete_id,workout_exercise_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["training-view-overrides", sessionId] });
      toast.success("Exercise swapped for this session");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const clearSwapMutation = useMutation({
    mutationFn: async (input: { athlete_id: string; workout_exercise_id: string }) => {
      if (!sessionId) throw new Error("No active session");
      const { error } = await supabase
        .from("rack_athlete_exercise_overrides")
        .delete()
        .eq("rack_session_id", sessionId)
        .eq("athlete_id", input.athlete_id)
        .eq("workout_exercise_id", input.workout_exercise_id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["training-view-overrides", sessionId] });
      toast.success("Reverted to prescribed exercise");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const markInjuredMutation = useMutation({
    mutationFn: async (input: { athlete_id: string; reason: string }) => {
      const athlete = athletes.find((a) => a.id === input.athlete_id);
      const organization_id = athlete?.organization_id ?? (await getScopedOrgId());
      const { error } = await supabase.from("attendance").upsert(
        {
          athlete_id: input.athlete_id,
          session_date: today(),
          present: false,
          status: input.reason,
          notes: `Marked ${input.reason} from Training View`,
          organization_id,
        },
        { onConflict: "athlete_id,session_date" },
      );
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["attendance"] });
      toast.success(`Athlete marked ${vars.reason} for today`);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });



  // Persist per-athlete slot rows
  useEffect(() => {
    if (!sessionId || selectedAthletes.length === 0) return;
    const rows = selectedAthletes.map((a, idx) => {
      const r = resolvedByAthlete.get(a.id);
      const active = effectiveWorkoutFor(a.id);
      const isOverride =
        workoutByAthlete[a.id] !== undefined && workoutByAthlete[a.id] !== r?.workoutId;
      return {
        rack_session_id: sessionId,
        athlete_id: a.id,
        quadrant: idx + 1,
        source_team_id: r?.teamId ?? a.team_id ?? null,
        assigned_workout_id: r?.workoutId ?? null,
        active_workout_id: active,
        override_reason: isOverride ? "manual_workout" : "assigned",
      };
    });
    void supabase
      .from("rack_session_athletes")
      .upsert(rows, { onConflict: "rack_session_id,athlete_id" });
    void supabase
      .from("rack_sessions")
      .update({ athlete_ids: selectedAthletes.map((a) => a.id) })
      .eq("id", sessionId);
  }, [sessionId, selectedAthletes, resolvedByAthlete, workoutByAthlete, effectiveWorkoutFor]);

  // ---- Selection helpers ----
  const bumpRecent = (id: string) => {
    const next = [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
    setRecent(next);
  };
  const toggleAthlete = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= layoutSize) {
        toast.error(`Layout is set to ${layoutSize} athletes — remove one or expand the grid.`);
        return prev;
      }
      bumpRecent(id);
      return [...prev, id];
    });
  };
  const removeAthlete = (id: string) => setSelectedIds((prev) => prev.filter((x) => x !== id));
  const clearSelection = () => setSelectedIds([]);




  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);


  // Rack sessions today (for "By Rack" selection + rack mode grouping)
  const rackSessionsQ = useQuery({
    queryKey: ["training-view-rack-sessions", today()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rack_sessions")
        .select("*")
        .eq("session_date", today())
        .order("rack_number");
      if (error) throw error;
      return (data ?? []) as unknown as RackSession[];
    },
    refetchInterval: 30_000,
  });
  const rackSessionAthletesQ = useQuery({
    queryKey: ["training-view-rsa"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rack_session_athletes")
        .select("rack_session_id, athlete_id, quadrant");
      if (error) throw error;
      return (data ?? []) as { rack_session_id: string; athlete_id: string; quadrant: number }[];
    },
    refetchInterval: 30_000,
  });
  const rackAthletesByRack = useMemo(() => {
    const sessions = rackSessionsQ.data ?? [];
    const rsa = rackSessionAthletesQ.data ?? [];
    const m = new Map<number, string[]>();
    for (const s of sessions) {
      const ids = rsa.filter((r) => r.rack_session_id === s.id).map((r) => r.athlete_id);
      if (ids.length > 0) m.set(s.rack_number, [...(m.get(s.rack_number) ?? []), ...ids]);
    }
    return m;
  }, [rackSessionsQ.data, rackSessionAthletesQ.data]);

  // ---- Today's leaders (per exercise: top load) ----
  const todayLeaderByExercise = useMemo(() => {
    const map = new Map<string, { athleteId: string; load: number }>();
    for (const l of logs) {
      if (l.status !== "completed" || l.load == null) continue;
      const cur = map.get(l.workout_exercise_id);
      if (!cur || l.load > cur.load)
        map.set(l.workout_exercise_id, { athleteId: l.athlete_id, load: l.load });
    }
    return map;
  }, [logs]);

  // ---- Log mutation ----
  const logMutation = useMutation({
    mutationFn: async (
      payload: Record<string, unknown> & {
        athlete_id: string;
        workout_exercise_id: string;
        set_position: number;
      },
    ) => {
      if (!sessionId) throw new Error("No session");
      const row = {
        ...payload,
        rack_session_id: sessionId,
        completed_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("rack_set_logs").upsert(row as never, {
        onConflict: "rack_session_id,athlete_id,workout_exercise_id,set_position",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["training-view-logs", sessionId] });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const activeCount = selectedAthletes.length;

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-[560px] flex-col gap-3 pb-[env(safe-area-inset-bottom)]">
      <Tabs value={mode} onValueChange={(v) => setMode(v as "assign" | "live")}>
        <TabsList>
          <TabsTrigger value="live">Live Training</TabsTrigger>
          <TabsTrigger value="assign">Assign Racks</TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "assign" ? (
        <div className="min-h-0 flex-1">
          <RackAssignmentBoard />
        </div>
      ) : (
      <div className="hud-grid flex min-h-0 flex-1 gap-3">



      {/* ---------------- Workspace ---------------- */}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/50 px-2 py-1.5">
          <div className="flex items-center gap-1">
            <span className="hidden pr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:inline">
              Layout
            </span>
            {([2, 4, 6, 8] as LayoutSize[]).map((n) => (
              <button
                key={n}
                onClick={() => setLayoutSize(n)}
                className={cn(
                  "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium tabular-nums transition-colors",
                  layoutSize === n
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {n === 2 && <Columns2 className="h-3.5 w-3.5" />}
                {n === 4 && <Grid2X2 className="h-3.5 w-3.5" />}
                {n === 6 && <Grid3X3 className="h-3.5 w-3.5" />}
                {n === 8 && <LayoutGrid className="h-3.5 w-3.5" />}
                {n}
              </button>
            ))}
            {activeCount > 0 && (
              <button
                onClick={clearSelection}
                className="ml-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                Clear ({activeCount})
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">

            <ToolbarToggle
              active={compact}
              onClick={() => setCompact((v) => !v)}
              icon={<Rows3 className="h-3.5 w-3.5" />}
              label={compact ? "Compact" : "Expanded"}
            />
            <ToolbarToggle
              active={rackMode}
              onClick={() => setRackMode((v) => !v)}
              icon={<LayoutGrid className="h-3.5 w-3.5" />}
              label="Rack mode"
            />
            <ToolbarToggle
              active={fullscreen}
              onClick={toggleFullscreen}
              icon={
                fullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )
              }
              label="Fullscreen"
            />
            <Button size="sm" variant="ghost" asChild className="h-7 px-2">
              <Link to="/training/live" className="text-xs">
                Facility view
              </Link>
            </Button>
          </div>
        </div>

        {/* Grid — one block per layout slot; empty blocks are athlete search cards */}
        {rackMode && activeCount > 0 ? (
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {groupByRack(selectedAthletes, rackAthletesByRack).map(({ rackNo, list }) => (
              <div key={rackNo ?? "unassigned"} className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span className="rounded-md bg-muted px-2 py-0.5 text-foreground">
                    {rackNo != null ? `Rack ${rackNo}` : "Unassigned"}
                  </span>
                  <span className="tabular-nums">
                    {list.length} athlete{list.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className={cn("grid auto-rows-min content-start gap-3", LAYOUT_GRID[layoutSize])}>
                  {list.map((a) => renderTile(a))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            className={cn(
              "grid flex-1 auto-rows-min content-start gap-3 overflow-y-auto overscroll-contain pb-6 pr-1",
              LAYOUT_GRID[layoutSize],
            )}
          >
            {Array.from({ length: layoutSize }).map((_, i) => {
              const a = selectedAthletes[i];
              if (a) return renderTile(a);
              return (
                <SlotPicker
                  key={`slot-${i}`}
                  index={i + 1}
                  athletes={athletes}
                  teamById={teamById}
                  selectedIds={selectedIds}
                  recentIds={recent}
                  onPick={(id) => toggleAthlete(id)}
                />
              );
            })}
          </div>
        )}


        {/* Focused athlete — full-screen so the numbers are readable from the floor */}
        {focusId && selectedAthletes.some((a) => a.id === focusId) && (
          <div className="fixed inset-0 z-[100] flex flex-col bg-background">
            <div className="safe-top flex items-center justify-between gap-2 border-b bg-background px-3 py-2">
              <div className="min-w-0 truncate text-base font-bold">
                {athleteDisplayName(selectedAthletes.find((a) => a.id === focusId)!)}
              </div>
              <Button size="sm" variant="secondary" onClick={() => setFocusId(null)}>
                <Minimize2 className="h-4 w-4" /> Back to grid
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain p-3">
              <div className="mx-auto max-w-2xl">
                {renderTile(selectedAthletes.find((a) => a.id === focusId)!, true)}
              </div>
            </div>
          </div>
        )}

      </section>
      </div>
      )}
    </div>
  );


  function renderTile(a: Athlete, focused = false) {
    const workoutId = effectiveWorkoutFor(a.id);
    const workout = workoutId ? (workouts.find((w) => w.id === workoutId) ?? null) : null;
    const team = teamById.get(a.team_id ?? "") ?? null;
    const athleteLogs = logs.filter((l) => l.athlete_id === a.id);
    const flash = flashById[a.id];
    return (
      <AthleteTile
        key={a.id + (focused ? ":focus" : "")}
        focused={focused}
        onToggleFocus={() => setFocusId((p) => (p === a.id ? null : a.id))}
        athlete={a}

        team={team}
        workout={workout}
        workouts={workouts}
        programs={programs}
        workoutExercises={workoutExercises}
        workoutSets={workoutSets}
        exercises={exerciseLib}
        measurementByExId={measurementByExId}
        repMaxes={repMaxes}
        logs={athleteLogs}
        allLogs={logs}
        flash={flash}
        compact={compact}
        onRemove={() => removeAthlete(a.id)}
        onSetWorkout={(wid) => setWorkoutByAthlete((p) => ({ ...p, [a.id]: wid }))}
        overrides={overridesByAthlete.get(a.id) ?? new Map()}
        onSwapExercise={(input) => swapMutation.mutate({ athlete_id: a.id, ...input })}
        onClearSwap={(workout_exercise_id) => clearSwapMutation.mutate({ athlete_id: a.id, workout_exercise_id })}
        onMarkOut={(reason) => {
          markInjuredMutation.mutate({ athlete_id: a.id, reason });
          removeAthlete(a.id);
        }}
        quadrant={selectedIds.indexOf(a.id) + 1}
        todayLeaderByExercise={todayLeaderByExercise}
        onLog={(payload) =>
          logMutation.mutate({
            ...payload,
            athlete_id: a.id,
            quadrant: selectedIds.indexOf(a.id) + 1,
          })
        }
      />
    );
  }
}

function groupByRack(list: Athlete[], byRack: Map<number, string[]>) {
  const inv = new Map<string, number>();
  for (const [rack, ids] of byRack) for (const id of ids) if (!inv.has(id)) inv.set(id, rack);
  const groups = new Map<number | null, Athlete[]>();
  for (const a of list) {
    const r = inv.get(a.id) ?? null;
    const arr = groups.get(r) ?? [];
    arr.push(a);
    groups.set(r, arr);
  }
  return [...groups.entries()]
    .sort((x, y) => (x[0] ?? 999) - (y[0] ?? 999))
    .map(([rackNo, list]) => ({ rackNo, list }));
}

// ============================================================================
// Slot picker — compact empty block that opens a full-screen athlete search
// ============================================================================

function SlotPicker({
  index,
  athletes,
  teamById,
  selectedIds,
  recentIds,
  onPick,
}: {
  index: number;
  athletes: Athlete[];
  teamById: Map<string, Team>;
  selectedIds: string[];
  recentIds: string[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const available = useMemo(
    () =>
      athletes
        .filter((a) => !selectedIds.includes(a.id))
        .sort((a, b) => athleteDisplayName(a).localeCompare(athleteDisplayName(b))),
    [athletes, selectedIds],
  );

  // Most-recently-picked athletes (across the whole session), most recent
  // first — a one-tap way to re-add someone you just removed instead of
  // retyping their name.
  const recentAvailable = useMemo(() => {
    const byId = new Map(athletes.map((a) => [a.id, a]));
    return recentIds
      .map((id) => byId.get(id))
      .filter((a): a is Athlete => !!a && !selectedIds.includes(a.id));
  }, [athletes, recentIds, selectedIds]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return available;
    return available.filter((a) => {
      const name = athleteDisplayName(a).toLowerCase();
      const team = teamById.get(a.team_id ?? "")?.name.toLowerCase() ?? "";
      return name.includes(needle) || team.includes(needle);
    });
  }, [available, q, teamById]);

  return (
    <>
      <button
        type="button"
        onClick={() => { setQ(""); setOpen(true); }}
        className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-muted/10 p-4 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/30 hover:text-foreground"
      >
        <Users className="h-5 w-5 opacity-60" />
        <span className="text-sm font-semibold">Click here to add athlete</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">
          Slot {index}
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-3 p-0">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>Add athlete to slot {index}</DialogTitle>
            <DialogDescription>
              {available.length} available · search by name or team
            </DialogDescription>
          </DialogHeader>
          <div className="relative px-4">
            <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search athlete or team"
              className="h-10 pl-8"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
            {!q.trim() && recentAvailable.length > 0 && (
              <>
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent
                </div>
                {recentAvailable.map((a) => (
                  <SlotPickerRow key={`recent-${a.id}`} athlete={a} team={teamById.get(a.team_id ?? "") ?? null} onPick={() => { onPick(a.id); setOpen(false); }} />
                ))}
                <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  All athletes
                </div>
              </>
            )}
            {results.map((a) => (
              <SlotPickerRow key={a.id} athlete={a} team={teamById.get(a.team_id ?? "") ?? null} onPick={() => { onPick(a.id); setOpen(false); }} />
            ))}
            {results.length === 0 && (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                No athletes match.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SlotPickerRow({ athlete, team, onPick }: { athlete: Athlete; team: Team | null; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
    >
      <Avatar name={athleteDisplayName(athlete)} color={team?.color ?? null} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{athleteDisplayName(athlete)}</div>
        <div className="truncate text-[11px] text-muted-foreground">{team?.name ?? "—"}</div>
      </div>
    </button>
  );
}


// ============================================================================
// Toolbar toggle
// ============================================================================

function ToolbarToggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}


// ============================================================================
// Avatar
// ============================================================================

function Avatar({
  name,
  color,
  size = "md",
}: {
  name: string;
  color?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const p = name.trim().split(/\s+/);
  const initials = ((p[0]?.[0] ?? "") + (p[p.length - 1]?.[0] ?? "")).toUpperCase() || "?";
  const dim =
    size === "sm" ? "h-6 w-6 text-[10px]" : size === "lg" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        dim,
      )}
      style={{ backgroundColor: color || "hsl(var(--primary))" }}
    >
      {initials}
    </div>
  );
}

// ============================================================================
// Athlete Tile — the core in-card logging surface
// ============================================================================

type TileLogPayload = {
  workout_exercise_id: string;
  set_position: number;
  load: number | null;
  reps: number | null;
  avg_velocity: number | null;
  time_seconds: number | null;
  distance_in: number | null;
  rpe: number | null;
  notes: string | null;
  status: "completed" | "skipped";
  active_workout_id: string | null;
  review_reason: string | null;
};

function AthleteTile(props: {
  athlete: Athlete;
  team: Team | null;
  workout: Workout | null;
  workouts: Workout[];
  programs: Program[];
  workoutExercises: WorkoutExercise[];
  workoutSets: WorkoutSet[];
  exercises: { id: string; name?: string; measurement_type?: string | null }[];
  measurementByExId: Map<string, Measurement>;
  repMaxes: RepMax[];
  logs: RackSetLog[];
  allLogs: RackSetLog[];
  flash: { at: number; kind: "set" | "pr" | "flag" } | undefined;
  compact: boolean;
  focused?: boolean;
  onToggleFocus?: () => void;
  quadrant: number;

  todayLeaderByExercise: Map<string, { athleteId: string; load: number }>;
  overrides: Map<string, RackAthleteOverride>;
  onRemove: () => void;
  onSetWorkout: (wid: string | null) => void;
  onSwapExercise: (input: {
    workout_exercise_id: string;
    substitute_exercise_id: string | null;
    substitute_exercise_name: string;
    reason: string | null;
  }) => void;
  onClearSwap: (workout_exercise_id: string) => void;
  onMarkOut: (reason: string) => void;
  onLog: (payload: TileLogPayload) => void;
}) {
  const {
    athlete,
    team,
    workout,
    workouts,
    programs,
    workoutExercises,
    workoutSets,
    exercises: exerciseLib,
    measurementByExId,
    repMaxes,
    logs,
    flash,
    compact,
    focused = false,
    onToggleFocus,

    todayLeaderByExercise,
    overrides,
    onRemove,
    onSetWorkout,
    onSwapExercise,
    onClearSwap,
    onMarkOut,
    onLog,
  } = props;
  const now = useNow(1000);

  // Prescribed sets in order
  const prescribed = useMemo(() => {
    if (!workout)
      return [] as Array<{
        exercise: WorkoutExercise;
        setPosition: number;
        setTotal: number;
        setRow: WorkoutSet | null;
      }>;
    const exs = workoutExercises
      .filter((e) => e.workout_id === workout.id)
      .sort((a, b) => a.position - b.position);
    const list: Array<{
      exercise: WorkoutExercise;
      setPosition: number;
      setTotal: number;
      setRow: WorkoutSet | null;
    }> = [];
    for (const ex of exs) {
      const rows = workoutSets
        .filter((s) => s.workout_exercise_id === ex.id)
        .sort((a, b) => a.position - b.position);
      // Each workout_sets row is a *scheme* (e.g. "3 sets of 4") — expand by `sets` count.
      const expanded: WorkoutSet[] = [];
      for (const r of rows) {
        const count = Math.max(1, Number(r.sets ?? 1) || 1);
        for (let k = 0; k < count; k++) expanded.push(r);
      }
      const total = expanded.length > 0 ? expanded.length : (ex.sets ?? 1);
      for (let i = 0; i < total; i++)
        list.push({ exercise: ex, setPosition: i + 1, setTotal: total, setRow: expanded[i] ?? null });
    }
    return list;
  }, [workout, workoutExercises, workoutSets]);

  const doneKey = (exId: string, pos: number) => `${exId}:${pos}`;
  const doneMap = useMemo(() => {
    const m = new Map<string, RackSetLog>();
    for (const l of logs) m.set(doneKey(l.workout_exercise_id, l.set_position), l);
    return m;
  }, [logs]);

  const totalSets = prescribed.length;
  const completedCount = logs.filter((l) => l.status === "completed").length;
  const pct = totalSets > 0 ? Math.round((completedCount / totalSets) * 100) : 0;
  const finished = totalSets > 0 && completedCount >= totalSets;

  // Cursor = first unlogged set
  const autoCursor = prescribed.findIndex(
    (p) => !doneMap.has(doneKey(p.exercise.id, p.setPosition)),
  );
  const [cursorOverride, setCursorOverride] = useState<number | null>(null);
  // Reopen (from FinishScreen) needs to actually swap the view back to the
  // sheet — `finished` alone can't do that since it stays true once every
  // set is logged, so it gates the FinishScreen render alongside it.
  const [reopened, setReopened] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  
  const cursor =
    cursorOverride ?? (autoCursor >= 0 ? autoCursor : Math.max(0, prescribed.length - 1));
  const current = prescribed[cursor];

  const currentOverride = current ? overrides.get(current.exercise.id) ?? null : null;
  const currentExerciseName = currentOverride?.substitute_exercise_name ?? current?.exercise.exercise_name ?? "";
  const currentMeasurement: Measurement = current
    ? (measurementByExId.get(currentOverride?.substitute_exercise_id ?? current.exercise.exercise_id ?? "") ?? "load")
    : "load";

  const prescribedLoad = current?.setRow?.load ?? current?.exercise.load ?? null;
  const prescribedReps = current?.setRow?.reps ?? current?.exercise.reps ?? null;

  // Snapshot rep maxes when this athlete's workout opens. Logging a set writes
  // new rep maxes; without freezing, every remaining set would get re-priced
  // mid-session (e.g. a 365 log bumping later sets off a 195 opener).
  const formula = useOrg1RMFormula();
  const frozenRepMaxes = useFrozen(
    repMaxes,
    `${athlete.id}:${workout?.id ?? "none"}`,
    repMaxes.length > 0,
  );

  const suggested = useMemo(() => {
    if (!current) return null;
    const referenceExerciseId = current.setRow?.percent_of_exercise_id ?? current.exercise.percent_of_exercise_id;
    const s = suggestLoad({
      athleteId: athlete.id,
      exercise: current.exercise,
      setRow: current.setRow,
      repMaxes: frozenRepMaxes,
      referenceExerciseName: referenceExerciseId
        ? exerciseLib.find((e) => e.id === referenceExerciseId)?.name ?? null
        : null,
      formula,
    });
    return s && s.basis !== "explicit" ? s : null;
  }, [current, athlete.id, frozenRepMaxes, exerciseLib, formula]);


  const [form, setForm] = useState({
    load: "", reps: "", avg_velocity: "", time: "", distance: "", timeUnit: "s" as "s" | "mph", rpe: "", notes: "",
  });
  const formKey = `${current?.exercise.id}:${current?.setPosition}`;
  const exerciseDistanceIn = useMemo(
    () => parseDistanceIn(current?.exercise.exercise_name),
    [current?.exercise.exercise_name],
  );
  const autoLoad =
    prescribedLoad != null ? String(prescribedLoad) : suggested ? String(suggested.load) : "";
  const autoLoadRef = useRef(autoLoad);
  autoLoadRef.current = autoLoad;
  const prescribedRepsRef = useRef(prescribedReps);
  prescribedRepsRef.current = prescribedReps;
  // Reset only when the coach moves to a different set — never because new
  // rep-max data landed while they were typing.
  useEffect(() => {
    setForm((prev) => ({
      load: autoLoadRef.current,
      reps: prescribedRepsRef.current != null ? String(prescribedRepsRef.current) : "",
      avg_velocity: "",
      time: "",
      // For mph exercises the distance field holds yards; prefill from the name.
      distance:
        currentMeasurement === "mph" && exerciseDistanceIn != null
          ? String(+(exerciseDistanceIn / 36).toFixed(2))
          : "",
      timeUnit: prev.timeUnit,
      rpe: "",
      notes: "",
    }));
  }, [formKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Late-arriving prescription data fills a still-empty field, nothing more.
  useEffect(() => {
    if (!autoLoad) return;
    setForm((prev) => (prev.load === "" ? { ...prev, load: autoLoad } : prev));
  }, [autoLoad]);


  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

  // Rest timer from last completed set
  const lastCompleted = useMemo(() => {
    let latest: RackSetLog | null = null;
    for (const l of logs) {
      if (l.status !== "completed") continue;
      if (!latest || new Date(l.completed_at).getTime() > new Date(latest.completed_at).getTime())
        latest = l;
    }
    return latest;
  }, [logs]);
  const restSec = lastCompleted
    ? Math.max(0, Math.floor((now - new Date(lastCompleted.completed_at).getTime()) / 1000))
    : null;
  const prescribedRest = current?.exercise.rest_seconds ?? null;
  const restOver = prescribedRest != null && restSec != null && restSec > prescribedRest;

  // PR / leader / flag state
  const isLeader =
    current && todayLeaderByExercise.get(current.exercise.id)?.athleteId === athlete.id;
  const flashActive = !!flash && now - flash.at < FLASH_MS;
  const isPr = flash?.kind === "pr" && flashActive;
  const isFlag = flash?.kind === "flag" && flashActive;
  const isNewSet = flash?.kind === "set" && flashActive;

  // Grouped exercise list for collapsible view
  const exGroups = useMemo(() => {
    const seen = new Map<
      string,
      { ex: WorkoutExercise; sets: Array<{ pos: number; log: RackSetLog | null }> }
    >();
    for (const p of prescribed) {
      let g = seen.get(p.exercise.id);
      if (!g) {
        g = { ex: p.exercise, sets: [] };
        seen.set(p.exercise.id, g);
      }
      g.sets.push({
        pos: p.setPosition,
        log: doneMap.get(doneKey(p.exercise.id, p.setPosition)) ?? null,
      });
    }
    return [...seen.values()];
  }, [prescribed, doneMap]);

  // Flat printed "workout sheet" — every exercise + every set visible at once.
  const sheet = useMemo(() => {
    const out: Array<{
      ex: WorkoutExercise;
      label: string;
      max: number | null;
      rows: Array<{
        pos: number;
        reps: string | number | null;
        load: number | null;
        percent: number | null;
        vel: number | null;
        log: RackSetLog | null;
        idx: number;
      }>;
    }> = [];
    const byEx = new Map<string, number>();
    prescribed.forEach((p, idx) => {
      let gi = byEx.get(p.exercise.id);
      if (gi == null) {
        gi = out.length;
        byEx.set(p.exercise.id, gi);
        const pb = personalBestFor(frozenRepMaxes, athlete.id, p.exercise);
        const l = (p.exercise.superset_group ?? String.fromCharCode(65 + gi)).toUpperCase();
        out.push({ ex: p.exercise, label: `${l}${gi + 1}`, max: pb?.load ?? null, rows: [] });
      }
      const s = suggestLoad({
        athleteId: athlete.id,
        exercise: p.exercise,
        setRow: p.setRow,
        repMaxes: frozenRepMaxes,
        referenceExerciseName: (p.setRow?.percent_of_exercise_id ?? p.exercise.percent_of_exercise_id)
          ? exerciseLib.find((e) => e.id === (p.setRow?.percent_of_exercise_id ?? p.exercise.percent_of_exercise_id))?.name ?? null
          : null,
        formula,
      });
      out[gi]!.rows.push({
        pos: p.setPosition,
        reps: p.setRow?.reps ?? p.exercise.reps ?? null,
        load: s ? s.load : null,
        percent: p.setRow?.percent ?? p.exercise.percent ?? null,
        vel: p.setRow?.target_velocity_min ?? null,
        log: doneMap.get(doneKey(p.exercise.id, p.setPosition)) ?? null,
        idx,
      });
    });
    return out;
  }, [prescribed, doneMap, frozenRepMaxes, athlete.id, exerciseLib, formula]);

  const letter = current?.exercise.superset_group ?? null;
  const exNum = current ? exGroups.findIndex((g) => g.ex.id === current.exercise.id) + 1 : 0;
  const exLabel = current ? `${letter ?? String.fromCharCode(64 + exNum)}${exNum}` : "";

  const doLog = (status: "completed" | "skipped") => {
    if (!current || !workout) return;
    let timeSec: number | null = null;
    let distIn: number | null = null;
    if (currentMeasurement === "seconds") {
      const raw = numOrNull(form.time);
      if (raw != null) {
        timeSec = form.timeUnit === "mph" && exerciseDistanceIn ? mphToSeconds(raw, exerciseDistanceIn) : raw;
      }
    } else if (currentMeasurement === "mph") {
      // Store canonically: distance (in) + elapsed seconds derived from the mph entry.
      const yd = numOrNull(form.distance) ?? (exerciseDistanceIn != null ? exerciseDistanceIn / 36 : null);
      distIn = yd != null ? yd * 36 : null;
      const mph = numOrNull(form.time);
      if (mph != null && distIn) timeSec = mphToSeconds(mph, distIn);
    } else if (currentMeasurement === "inches") {
      distIn = numOrNull(form.distance);
    }
    // A completed load-based set beats the athlete's stored rep-max load: real
    // PR, flag it via review_reason (override_status's CHECK constraint
    // doesn't allow 'pr' — review_reason is free text and is already read as
    // an equally-valid PR signal by the flash/confetti/FinishScreen logic).
    const loggedLoad = currentMeasurement === "load" ? numOrNull(form.load) : null;
    const priorBest = personalBestFor(repMaxes, athlete.id, current.exercise);
    const isPr = status === "completed" && loggedLoad != null && !!priorBest && loggedLoad > priorBest.load;
    onLog({
      workout_exercise_id: current.exercise.id,
      set_position: current.setPosition,
      load: loggedLoad,
      reps: numOrNull(form.reps),
      avg_velocity: currentMeasurement === "load" ? numOrNull(form.avg_velocity) : null,
      time_seconds: timeSec,
      distance_in: distIn,
      rpe: numOrNull(form.rpe),
      notes: form.notes.trim() || null,
      status,
      active_workout_id: workout.id,
      review_reason: isPr ? "pr" : null,
    });
    setCursorOverride(null);
  };

  const isLive = !!workout && !finished && completedCount > 0;

  // Logging panel for the current set — rendered inline under its exercise row.
  const focusPanel = (() => {
    if (!current) return null;
    const lastResult = latestLogFor(logs, current.exercise.id, current.setPosition);
    const priorSame = priorLogFor(logs, current.exercise.id, current.setPosition, lastResult?.id);
    const pb = personalBestFor(repMaxes, athlete.id, current.exercise);
    const remainingInEx = current.setTotal - (current.setPosition - 1);
    const btnLabel = remainingInEx === 1 ? "Log last set" : `Log set ${current.setPosition}`;
    return (
      <div className="border-t border-primary/30 bg-primary/[0.04] px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Set {current.setPosition} of {current.setTotal}
          </span>
          {restSec != null && (
            <div
              className={cn(
                "ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                restOver
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Timer className="h-3 w-3" />
              {formatDuration(restSec)}
              {prescribedRest != null && (
                <span className="opacity-60">/{formatDuration(prescribedRest)}</span>
              )}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-primary/40 bg-primary/[0.06] px-3 py-2">
          <div className="text-xl font-black leading-tight tabular-nums">
            {prescribedLoad != null || prescribedReps != null
              ? `${prescribedLoad != null ? `${prescribedLoad} lb` : ""}${prescribedLoad != null && prescribedReps != null ? " × " : ""}${prescribedReps != null ? `${prescribedReps} reps` : ""}`
              : suggested
                ? `~${suggested.load} lb`
                : "Coach's call"}
          </div>
          {(priorSame || pb) && (
            <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
              {priorSame && (
                <span>
                  Last time: {priorSame.load ?? "—"}
                  {priorSame.load != null ? " lb" : ""}
                  {priorSame.reps != null ? ` × ${priorSame.reps}` : ""}
                </span>
              )}
              {priorSame && pb && <span> · </span>}
              {pb && (
                <span>
                  Best: {pb.load} lb{pb.reps > 1 ? ` × ${pb.reps}` : ""}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Inputs — only what's needed to log this set */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          {currentMeasurement === "load" && (
            <>
              <NumInput label="Weight" value={form.load} onChange={(v) => setForm({ ...form, load: v })} suffix="lb" />
              <NumInput label="Reps" value={form.reps} onChange={(v) => setForm({ ...form, reps: v })} />
            </>
          )}
          {currentMeasurement === "seconds" && (
            <div className="col-span-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Time
                </span>
                {exerciseDistanceIn != null && (
                  <div className="inline-flex overflow-hidden rounded border border-border/60 text-[9px] font-semibold uppercase">
                    <button
                      type="button"
                      className={cn("px-2 py-1", form.timeUnit === "s" ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground")}
                      onClick={() => setForm({ ...form, timeUnit: "s" })}
                    >
                      s
                    </button>
                    <button
                      type="button"
                      className={cn("px-2 py-1", form.timeUnit === "mph" ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground")}
                      onClick={() => setForm({ ...form, timeUnit: "mph" })}
                    >
                      mph
                    </button>
                  </div>
                )}
              </div>
              <NumInput
                label=""
                value={form.time}
                onChange={(v) => setForm({ ...form, time: v })}
                suffix={form.timeUnit}
              />
            </div>
          )}
          {currentMeasurement === "inches" && (
            <div className="col-span-2">
              <NumInput label="Distance" value={form.distance} onChange={(v) => setForm({ ...form, distance: v })} suffix="in" />
            </div>
          )}
          {currentMeasurement === "mph" && (
            <>
              <NumInput label="Speed" value={form.time} onChange={(v) => setForm({ ...form, time: v })} suffix="mph" />
              <NumInput label="Dist" value={form.distance} onChange={(v) => setForm({ ...form, distance: v })} suffix="yd" />
            </>
          )}
          {currentMeasurement === "reps" && (
            <div className="col-span-2">
              <NumInput label="Reps" value={form.reps} onChange={(v) => setForm({ ...form, reps: v })} />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowExtra(!showExtra)}
          className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {showExtra ? "Hide extras" : "Add RPE / more"}
        </button>
        {showExtra && (
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {currentMeasurement === "load" && (
              <NumInput label="Vel" value={form.avg_velocity} onChange={(v) => setForm({ ...form, avg_velocity: v })} suffix="m/s" />
            )}
            {currentMeasurement !== "reps" && (
              <NumInput label="Reps" value={form.reps} onChange={(v) => setForm({ ...form, reps: v })} />
            )}
            <NumInput label="RPE" value={form.rpe} onChange={(v) => setForm({ ...form, rpe: v })} />
          </div>
        )}
        {currentMeasurement === "seconds" && form.timeUnit === "mph" && exerciseDistanceIn != null && form.time && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            ≈ {mphToSeconds(Number(form.time), exerciseDistanceIn).toFixed(2)}s over {(exerciseDistanceIn / 36).toFixed(0)}y
          </div>
        )}
        {currentMeasurement === "mph" && form.time && Number(form.distance) > 0 && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            ≈ {mphToSeconds(Number(form.time), Number(form.distance) * 36).toFixed(2)}s over {Number(form.distance)}y
          </div>
        )}

        <div className="mt-2 flex items-center gap-1.5">
          <Button
            className="h-11 flex-1 gap-1.5 text-sm font-semibold shadow-[0_0_0_1px_color-mix(in_oklab,var(--neon-primary)_35%,transparent),0_0_18px_-2px_color-mix(in_oklab,var(--neon-primary)_55%,transparent)] hover:shadow-[0_0_0_1px_color-mix(in_oklab,var(--neon-primary)_55%,transparent),0_0_26px_-2px_color-mix(in_oklab,var(--neon-primary)_75%,transparent)] transition-shadow"
            onClick={() => doLog("completed")}
          >
            <Check className="h-4 w-4" /> {btnLabel}
          </Button>
          <Button
            variant="outline"
            className="h-11 w-11 p-0"
            onClick={() => doLog("skipped")}
            title="Skip / miss"
          >
            <X className="h-4 w-4" />
          </Button>
          <NotePopover value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
        </div>

        {current.exercise.notes && (
          <div className="mt-1.5 rounded-md border border-border/40 bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
            <span className="font-semibold text-foreground">Coach:</span> {current.exercise.notes}
          </div>
        )}
      </div>
    );
  })();



  return (
    <Card
      className={cn(
        "relative flex flex-col overflow-y-auto overscroll-contain border transition-all duration-200",
        focused ? "max-h-none" : "max-h-[calc(100dvh-11rem)]",
        "shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.25)]",
        compact && !focused ? "gap-1.5" : "gap-2",

        // Neon HUD state layering — PR (violet) beats flag beats new-set beats live.
        isPr && "neon-pr",
        isFlag && "border-red-500 ring-2 ring-red-500/40",
        isNewSet && !isPr && !isFlag && "border-primary/60 bg-primary/[0.04]",
        !isPr && !isFlag && isLive && "neon-live",
        !isPr && !isFlag && !isNewSet && !isLive && "border-border/60",
      )}
    >
      {/* Live indicator — top-left, only when a set has been logged and workout isn't done */}
      {isLive && !isPr && !isFlag && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md bg-background/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-primary backdrop-blur-sm">
          <span className="live-dot" aria-hidden />
          Live
        </div>
      )}

      {/* Flash overlay label */}
      {flashActive && (
        <div
          className={cn(
            "pointer-events-none absolute right-2 top-2 z-10 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider animate-fade-in",
            isPr
              ? "bg-[var(--neon-accent)] text-white shadow-[0_0_18px_-2px_var(--neon-accent)]"
              : isFlag
                ? "bg-red-500 text-white"
                : "bg-primary text-primary-foreground",
          )}
        >
          {isPr ? "PR!" : isFlag ? "Review" : "New set"}

        </div>
      )}
      {isPr && <ConfettiBurst />}

      {/* Header */}
      <header
        className={cn("flex items-start justify-between gap-2 px-3", compact ? "pt-2" : "pt-3")}
      >
        <button
          type="button"
          onClick={onToggleFocus}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          title={focused ? "Back to grid" : "Expand this athlete"}
        >
          <Avatar
            name={athleteDisplayName(athlete)}
            color={team?.color ?? null}
            size={compact && !focused ? "md" : "lg"}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3
                className={cn(
                  "truncate font-bold tracking-tight",
                  focused ? "text-xl" : compact ? "text-base" : "text-lg",
                )}
              >
                {athleteDisplayName(athlete)}
              </h3>
              {isLeader && (
                <Trophy className="h-3.5 w-3.5 text-amber-500" aria-label="Top load today" />
              )}
            </div>
            <div className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
              {team && <span className="truncate">{team.name}</span>}
              {workout && <span className="truncate">· {workout.name}</span>}
              {lastCompleted && (
                <span className="whitespace-nowrap">
                  · {relTime(new Date(lastCompleted.completed_at).getTime(), now)} ago
                </span>
              )}
            </div>
          </div>
          <span
            className={cn(
              "ml-1 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold",
              focused
                ? "bg-muted text-foreground"
                : "bg-primary/10 text-primary ring-1 ring-primary/30",
            )}
          >
            {focused ? (
              <>
                <Minimize2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Back</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Expand</span>
              </>
            )}
          </span>
        </button>

        <TileActions
          onRemove={onRemove}
          onSwapWorkout={onSetWorkout}
          workouts={workouts}
          programs={programs}
          athleteProgramId={athlete.program_id}
          athleteId={athlete.id}
          athleteName={athleteDisplayName(athlete)}
          currentWorkoutId={workout?.id ?? null}
          currentExerciseId={current?.exercise.id ?? null}
          currentExerciseLabel={currentExerciseName}
          hasOverride={!!currentOverride}
          exerciseLib={exerciseLib as { id: string; name: string }[]}
          onSwapExercise={(sub) => {
            if (!current) return;
            onSwapExercise({
              workout_exercise_id: current.exercise.id,
              substitute_exercise_id: sub.id,
              substitute_exercise_name: sub.name,
              reason: sub.reason ?? null,
            });
          }}
          onClearSwap={() => current && onClearSwap(current.exercise.id)}
          onMarkOut={onMarkOut}
        />
      </header>

      {/* Progress */}
      <div className="px-3">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="tabular-nums">
            {completedCount}/{totalSets} sets · {pct}%
          </span>
          {!finished && totalSets - completedCount > 0 && (
            <span className="tabular-nums">
              ~{estimateRemaining(prescribed, completedCount)}m left
            </span>
          )}
        </div>
        <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              finished ? "bg-emerald-500" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Body */}
      {!workout ? (
        <div className="space-y-2 px-3 pb-3 pt-2 text-center">
          <p className="text-xs text-muted-foreground">No workout auto-assigned for today.</p>
          <HierarchicalWorkoutPickerTrigger
            programs={programs}
            workouts={workouts}
            athleteProgramId={athlete.program_id}
            currentWorkoutId={null}
            onPick={onSetWorkout}
            trigger={
              <Button size="sm" variant="outline" className="h-9 w-full gap-1.5 text-xs">
                <BookOpen className="h-3.5 w-3.5" /> Choose workout
              </Button>
            }
          />
        </div>
      ) : finished && !reopened ? (
        <FinishScreen
          athlete={athlete}
          logs={logs}
          onReopen={() => {
            setCursorOverride(prescribed.length - 1);
            setReopened(true);
          }}
        />
      ) : (
        /* Printed workout sheet — every exercise and every set visible, no drill-down */
        <div className="px-2 pb-2">
          {sheet.map((g) => {
            const isActive = current?.exercise.id === g.ex.id;
            const ov = overrides.get(g.ex.id) ?? null;
            const name = ov?.substitute_exercise_name ?? g.ex.exercise_name;
                    const showVel = g.rows.some((r) => r.vel != null);
                    return (
                      <div key={g.ex.id} className="mt-1.5 overflow-hidden rounded-md border border-border/50">
                        <div
                          className={cn(
                            "flex items-center gap-1.5 px-1.5 py-1",
                            isActive ? "bg-primary/10" : "bg-muted/40",
                          )}
                        >
                          <span
                            className={cn(
                              "grid h-4 w-6 shrink-0 place-items-center rounded-[3px] text-[9px] font-bold text-white",
                              g.rows.every((r) => r.log?.status === "completed")
                                ? "bg-emerald-500"
                                : (SUPERSET_ACCENT[g.label[0]!] ?? "bg-slate-500"),
                            )}
                          >
                            {g.label}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12px] font-bold uppercase tracking-tight">
                            {name}
                          </span>
                          {g.max != null && (
                            <span className="shrink-0 text-[9px] font-semibold uppercase tabular-nums text-muted-foreground">
                              Max {g.max}
                            </span>
                          )}
                        </div>

                        <table className="w-full table-fixed border-collapse text-[11px] tabular-nums">
                          <thead>
                            <tr className="text-[8px] uppercase tracking-wider text-muted-foreground">
                              <th className="w-10 px-1 py-0.5 text-left font-medium">Set</th>
                              <th className="px-1 py-0.5 text-left font-medium">Reps</th>
                              <th className="px-1 py-0.5 text-left font-medium">Wt</th>
                              {showVel && <th className="w-12 px-1 py-0.5 text-left font-medium">Vel</th>}
                              <th className="w-8 px-1 py-0.5" />
                            </tr>
                          </thead>
                          <tbody>
                            {g.rows.map((r) => {
                              const done = r.log?.status === "completed";
                              const skipped = r.log?.status === "skipped";
                              const isCurrent = current?.exercise.id === g.ex.id && current.setPosition === r.pos;
                              return (
                                <tr
                                  key={r.pos}
                                  onClick={() => setCursorOverride(r.idx)}
                                  className={cn(
                                    "cursor-pointer border-t border-border/30",
                                    done && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                                    skipped && "text-muted-foreground line-through",
                                    isCurrent && !done && "bg-primary/10 font-semibold",
                                  )}
                                >
                                  <td className="px-1 py-1">{r.pos}</td>
                                  <td className="px-1 py-1">{done ? (r.log?.reps ?? "—") : (r.reps ?? "—")}</td>
                                  <td className="px-1 py-1 font-semibold">
                                    {done ? (r.log?.load ?? "—") : (r.load ?? "—")}
                                  </td>
                                  {showVel && (
                            <td className="px-1 py-1">
                              {done
                                ? (r.log?.avg_velocity ?? "—")
                                : r.vel != null
                                  ? `${r.vel}`
                                  : "—"}
                            </td>
                          )}
                          <td className="px-1 py-1 text-right">
                            {done ? (
                              <Check className="ml-auto h-3.5 w-3.5" />
                            ) : isCurrent ? (
                              <span className="ml-auto block h-1.5 w-1.5 rounded-full bg-primary" />
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {isActive && focusPanel}
              </div>
            );
          })}
        </div>
      )}

    </Card>
  );
}

// ============================================================================
// Tile helpers — data lookups
// ============================================================================

function latestLogFor(logs: RackSetLog[], exId: string, setPos: number): RackSetLog | null {
  return logs.find((l) => l.workout_exercise_id === exId && l.set_position === setPos) ?? null;
}

function priorLogFor(
  logs: RackSetLog[],
  exId: string,
  setPos: number,
  excludeId?: string,
): RackSetLog | null {
  // Look for the same set position from a prior session — currently we only have today's logs,
  // so fall back to the previous set of the same exercise if today has no prior log.
  const forEx = logs
    .filter((l) => l.workout_exercise_id === exId && l.id !== excludeId && l.status === "completed")
    .sort((a, b) => b.set_position - a.set_position);
  return forEx.find((l) => l.set_position < setPos) ?? forEx[0] ?? null;
}

function personalBestFor(
  repMaxes: RepMax[],
  athleteId: string,
  ex: WorkoutExercise,
): { load: number; reps: number } | null {
  const candidates = repMaxes.filter(
    (r) =>
      r.athlete_id === athleteId &&
      ((ex.exercise_id && r.exercise_id === ex.exercise_id) ||
        r.exercise_name?.toLowerCase() === ex.exercise_name.toLowerCase()),
  );
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) => (b.load > a.load ? b : a));
  return { load: best.load, reps: best.reps };
}

function estimateRemaining(prescribed: Array<{ exercise: WorkoutExercise }>, done: number): number {
  const remaining = prescribed.slice(done);
  const totalSec = remaining.reduce((sum, p) => sum + (p.exercise.rest_seconds ?? 90) + 30, 0);
  return Math.max(1, Math.round(totalSec / 60));
}


// ============================================================================
// Tile helpers
// ============================================================================

function NumInput({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
}) {
  return (
    <label className="relative flex min-w-0 flex-col">
      <span className="mb-0.5 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {suffix && <span className="ml-1 opacity-70">({suffix})</span>}
      </span>
      <Input
        value={value}
        onChange={(e) => onChange(sanitizeNumInput(e.target.value))}
        inputMode="decimal"
        placeholder="—"
        className="h-12 w-full min-w-0 px-1 text-center font-mono text-lg font-bold tabular-nums"
      />
    </label>
  );

}

// Digits + at most one decimal point, no sign — a mid-set weight/rep/time
// entry is never negative, and a stray "-" or second "." typo shouldn't
// reach the DB.
function sanitizeNumInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}

function NotePopover({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 px-2" title="Coach note">
          <StickyNote className={cn("h-3.5 w-3.5", value && "text-primary")} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-2">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Coach note for this set"
          className="min-h-[80px] text-xs"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TileActions({
  onRemove,
  onSwapWorkout,
  workouts,
  programs,
  athleteProgramId,
  athleteId,
  athleteName,
  currentWorkoutId,
  currentExerciseId,
  currentExerciseLabel,
  hasOverride,
  exerciseLib,
  onSwapExercise,
  onClearSwap,
  onMarkOut,
}: {
  onRemove: () => void;
  onSwapWorkout: (wid: string | null) => void;
  workouts: Workout[];
  programs: Program[];
  athleteProgramId: string | null;
  athleteId: string;
  athleteName: string;
  currentWorkoutId: string | null;
  currentExerciseId: string | null;
  currentExerciseLabel: string;
  hasOverride: boolean;
  exerciseLib: { id: string; name: string }[];
  onSwapExercise: (sub: { id: string | null; name: string; reason?: string | null }) => void;
  onClearSwap: () => void;
  onMarkOut: (reason: string) => void;
}) {
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapSearch, setSwapSearch] = useState("");
  const [swapReason, setSwapReason] = useState("injury");
  const [customName, setCustomName] = useState("");
  const [confirmReason, setConfirmReason] = useState<"injured" | "excused" | null>(null);

  return (
    <div className="flex items-center gap-0.5">
      <HierarchicalWorkoutPickerTrigger
        programs={programs}
        workouts={workouts}
        athleteProgramId={athleteProgramId}
        currentWorkoutId={currentWorkoutId}
        onPick={onSwapWorkout}
        trigger={
          <Button size="icon" variant="ghost" className="h-8 w-8" title="Change workout">
            <BookOpen className="h-4 w-4" />
          </Button>
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem asChild>
            <Link to="/athletes/$id" params={{ id: athleteId }} className="cursor-pointer">
              <UserRound className="mr-2 h-3.5 w-3.5" /> Open profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/leaderboards" className="cursor-pointer">
              <Trophy className="mr-2 h-3.5 w-3.5" /> Leaderboards
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!currentExerciseId}
            onClick={() => setSwapOpen(true)}
          >
            <Replace className="mr-2 h-3.5 w-3.5" /> Swap exercise…
          </DropdownMenuItem>
          {hasOverride && (
            <DropdownMenuItem onClick={onClearSwap}>
              <RotateCw className="mr-2 h-3.5 w-3.5" /> Revert to prescribed
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setConfirmReason("injured")}>
            <HeartPulse className="mr-2 h-3.5 w-3.5" /> Mark injured (remove)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setConfirmReason("excused")}>
            <HeartPulse className="mr-2 h-3.5 w-3.5" /> Mark excused / out
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onRemove}>
            <ArrowRightLeft className="mr-2 h-3.5 w-3.5" /> Remove from grid
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={!!confirmReason} onOpenChange={(open) => !open && setConfirmReason(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Mark {athleteName} {confirmReason === "injured" ? "injured" : "excused"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This logs today's attendance as {confirmReason} and removes {athleteName} from the grid. You can
              re-add them from an empty slot afterward if this was a mistake.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmReason) onMarkOut(confirmReason);
                setConfirmReason(null);
              }}
            >
              {confirmReason === "injured" ? "Mark injured" : "Mark excused"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={swapOpen} onOpenChange={setSwapOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Swap exercise</DialogTitle>
            <DialogDescription>
              Replace <span className="font-medium text-foreground">{currentExerciseLabel}</span> for this athlete in this session only.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Reason</Label>
              <select
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={swapReason}
                onChange={(e) => setSwapReason(e.target.value)}
              >
                <option value="injury">Injury / modification</option>
                <option value="equipment">Equipment unavailable</option>
                <option value="coach">Coach decision</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Substitute from library</Label>
              <Command className="mt-1 rounded-md border">
                <CommandInput placeholder="Search exercises…" value={swapSearch} onValueChange={setSwapSearch} />
                <CommandList className="max-h-48">
                  <CommandEmpty>No matches.</CommandEmpty>
                  <CommandGroup>
                    {exerciseLib.slice(0, 200).map((e) => (
                      <CommandItem
                        key={e.id}
                        value={e.name}
                        onSelect={() => {
                          onSwapExercise({ id: e.id, name: e.name, reason: swapReason });
                          setSwapOpen(false);
                          setSwapSearch("");
                          setCustomName("");
                        }}
                      >
                        {e.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
            <div>
              <Label className="text-xs">Or custom name</Label>
              <div className="mt-1 flex gap-2">
                <Input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g. Belt Squat"
                />
                <Button
                  size="sm"
                  disabled={!customName.trim()}
                  onClick={() => {
                    onSwapExercise({ id: null, name: customName.trim(), reason: swapReason });
                    setSwapOpen(false);
                    setSwapSearch("");
                    setCustomName("");
                  }}
                >
                  Use
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSwapOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Hierarchical workout picker — Program → Phase → Cycle → Workout
// ============================================================================

function HierarchicalWorkoutPickerTrigger({
  programs,
  workouts,
  athleteProgramId,
  currentWorkoutId,
  onPick,
  trigger,
}: {
  programs: Program[];
  workouts: Workout[];
  athleteProgramId: string | null;
  currentWorkoutId: string | null;
  onPick: (workoutId: string) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [browseAll, setBrowseAll] = useState(false);
  const scoped = useMemo(() => {
    if (browseAll || !athleteProgramId) return programs;
    const assigned = programs.find((p) => p.id === athleteProgramId);
    return assigned ? [assigned] : programs;
  }, [browseAll, programs, athleteProgramId]);
  const isScoped = !browseAll && !!athleteProgramId;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border/50 px-2 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {isScoped ? "Assigned program" : "All programs"}
          </span>
          {athleteProgramId && (
            <button
              onClick={() => setBrowseAll((v) => !v)}
              className="text-[10px] font-medium text-primary hover:underline"
            >
              {browseAll ? "← Assigned only" : "Browse all programs"}
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto p-1">
          {scoped.length === 0 && (
            <div className="p-3 text-center text-xs text-muted-foreground">
              No programs available.
            </div>
          )}
          {scoped.map((p) => (
            <ProgramPickerNode
              key={p.id}
              program={p}
              workouts={workouts}
              currentWorkoutId={currentWorkoutId}
              defaultOpen={scoped.length === 1}
              onPick={(wid) => {
                onPick(wid);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ProgramPickerNode({
  program,
  workouts,
  currentWorkoutId,
  defaultOpen,
  onPick,
}: {
  program: Program;
  workouts: Workout[];
  currentWorkoutId: string | null;
  defaultOpen: boolean;
  onPick: (wid: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { data: phases = [] } = useQuery({ ...programPhasesQO(program.id), enabled: open });
  const { data: cycles = [] } = useQuery({ ...programCyclesQO(program.id), enabled: open });
  const { data: sessions = [] } = useQuery({ ...programSessionsQO(program.id), enabled: open });
  const hasHierarchy = phases.length > 0;

  return (
    <div className="mb-0.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs font-semibold hover:bg-muted"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <FolderKanban className="h-3 w-3 text-muted-foreground" />
        <span className="truncate">{program.name}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-border/40 pl-1">
          {hasHierarchy ? (
            phases.map((phase) => (
              <PhasePickerNode
                key={phase.id}
                phase={phase}
                cycles={cycles.filter((c) => c.phase_id === phase.id)}
                sessions={sessions}
                onPick={onPick}
                currentWorkoutId={currentWorkoutId}
              />
            ))
          ) : (
            <FlatWorkoutsForProgram
              programId={program.id}
              teamId={program.team_id}
              workouts={workouts}
              onPick={onPick}
              currentWorkoutId={currentWorkoutId}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PhasePickerNode({
  phase,
  cycles,
  sessions,
  onPick,
  currentWorkoutId,
}: {
  phase: { id: string; name: string; color: string | null };
  cycles: { id: string; name: string; phase_id: string; weeks: number }[];
  sessions: {
    id: string;
    cycle_id: string;
    workout_id: string | null;
    name: string;
    week: number;
    day: number;
  }[];
  onPick: (wid: string) => void;
  currentWorkoutId: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Layers className="h-3 w-3" style={{ color: phase.color || undefined }} />
        <span className="truncate font-medium">{phase.name}</span>
        <span className="ml-auto text-[9px] text-muted-foreground">{cycles.length}c</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-border/40 pl-1">
          {cycles.length === 0 && (
            <div className="px-1 py-0.5 text-[10px] text-muted-foreground">No cycles</div>
          )}
          {cycles.map((c) => (
            <CyclePickerNode
              key={c.id}
              cycle={c}
              sessions={sessions.filter((s) => s.cycle_id === c.id)}
              onPick={onPick}
              currentWorkoutId={currentWorkoutId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CyclePickerNode({
  cycle,
  sessions,
  onPick,
  currentWorkoutId,
}: {
  cycle: { id: string; name: string; weeks: number };
  sessions: { id: string; workout_id: string | null; name: string; week: number; day: number }[];
  onPick: (wid: string) => void;
  currentWorkoutId: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <CalendarDays className="h-3 w-3 text-muted-foreground" />
        <span className="truncate">{cycle.name}</span>
        <span className="ml-auto text-[9px] text-muted-foreground">
          {cycle.weeks}w · {sessions.length}
        </span>
      </button>
      {open && (
        <div className="ml-3 border-l border-border/40 pl-1">
          {sessions.length === 0 && (
            <div className="px-1 py-0.5 text-[10px] text-muted-foreground">No sessions</div>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              disabled={!s.workout_id}
              onClick={() => s.workout_id && onPick(s.workout_id)}
              className={cn(
                "flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs",
                s.workout_id === currentWorkoutId
                  ? "bg-primary/15 font-semibold"
                  : "hover:bg-muted",
                !s.workout_id && "cursor-not-allowed opacity-50",
              )}
            >
              <Dumbbell className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{s.name}</span>
              <span className="ml-auto text-[9px] tabular-nums text-muted-foreground">
                W{s.week}·D{s.day}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FlatWorkoutsForProgram({
  programId,
  teamId,
  workouts,
  onPick,
  currentWorkoutId,
}: {
  programId: string;
  teamId: string | null;
  workouts: Workout[];
  onPick: (wid: string) => void;
  currentWorkoutId: string | null;
}) {
  const { data: pws = [] } = useQuery(programWorkoutsForProgramQO(programId));
  const rows =
    pws.length > 0
      ? pws
          .map((pw) => ({ pw, w: workouts.find((w) => w.id === pw.workout_id) }))
          .filter((r) => r.w)
      : workouts
          .filter((w) => w.team_id === teamId)
          .map((w) => ({ pw: null as null | { week: number; day: number }, w }));
  if (rows.length === 0)
    return <div className="px-1 py-0.5 text-[10px] text-muted-foreground">No workouts</div>;
  return (
    <div className="space-y-0.5 py-0.5">
      {rows.map(({ pw, w }) => (
        <button
          key={w!.id}
          onClick={() => onPick(w!.id)}
          className={cn(
            "flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs",
            w!.id === currentWorkoutId ? "bg-primary/15 font-semibold" : "hover:bg-muted",
          )}
        >
          <Dumbbell className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{w!.name}</span>
          {pw && (
            <span className="ml-auto text-[9px] tabular-nums text-muted-foreground">
              W{pw.week}·D{pw.day}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function programWorkoutsForProgramQO(programId: string) {
  return {
    queryKey: ["program_workouts", "for", programId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("program_workouts")
        .select("*")
        .eq("program_id", programId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; workout_id: string; week: number; day: number }>;
    },
  };
}

function FinishScreen({
  athlete,
  logs,
  onReopen,
}: {
  athlete: Athlete;
  logs: RackSetLog[];
  onReopen: () => void;
}) {
  const prs = logs.filter((l) => l.override_status === "pr" || l.review_reason === "pr").length;
  const first = logs.reduce<Date | null>((min, l) => {
    const d = new Date(l.completed_at);
    return !min || d < min ? d : min;
  }, null);
  const last = logs.reduce<Date | null>((max, l) => {
    const d = new Date(l.completed_at);
    return !max || d > max ? d : max;
  }, null);
  const durationMin =
    first && last ? Math.max(1, Math.round((last.getTime() - first.getTime()) / 60000)) : null;
  return (
    <div className="flex flex-col items-center gap-2 px-3 pb-3 pt-2 text-center">
      <div className="rounded-full bg-emerald-500/15 p-2 text-emerald-500">
        <Check className="h-6 w-6" />
      </div>
      <h4 className="text-sm font-semibold">Workout complete</h4>
      <p className="text-xs text-muted-foreground">
        Nice work, {athleteDisplayName(athlete).split(" ")[0]}.
      </p>
      <div className="grid w-full grid-cols-3 gap-1 pt-1">
        <FinishStat label="Sets" value={logs.filter((l) => l.status === "completed").length} />
        <FinishStat label="PRs" value={prs} highlight={prs > 0} />
        <FinishStat label="Time" value={durationMin != null ? `${durationMin}m` : "—"} />
      </div>
      <div className="flex gap-1.5 pt-1">
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onReopen}>
          <RotateCcw className="h-3 w-3" /> Reopen
        </Button>
      </div>
      <p className="pt-1 text-[10px] text-muted-foreground">Reminder: hydrate & log recovery.</p>
    </div>
  );
}

function FinishStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border/50 bg-muted/30 p-1.5",
        highlight && "border-emerald-500/40 bg-emerald-500/10",
      )}
    >
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

// ============================================================================
// Confetti (CSS burst — no dependency)
// ============================================================================

function ConfettiBurst() {
  const pieces = Array.from({ length: 14 });
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {pieces.map((_, i) => {
        const angle = (i / pieces.length) * Math.PI * 2;
        const dx = Math.cos(angle) * 60;
        const dy = Math.sin(angle) * 40;
        const colors = ["#10b981", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6"];
        return (
          <span
            key={i}
            className="absolute left-1/2 top-1/3 h-1.5 w-1.5 rounded-sm animate-fade-out"
            style={{
              backgroundColor: colors[i % colors.length],
              transform: `translate(${dx}px, ${dy}px) rotate(${i * 30}deg)`,
              animationDuration: "1.5s",
            }}
          />
        );
      })}
    </div>
  );
}

// ============================================================================
// Utilities
// ============================================================================

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function relTime(ts: number, now: number) {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}
