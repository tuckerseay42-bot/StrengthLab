import { useEffect, useMemo, useRef, useState } from "react";
import { estimate1RM as estimate1RMShared } from "@/lib/one-rm";
import { getOrg1RMFormula } from "@/hooks/use-1rm-formula";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  workoutExercisesQO, workoutSetsQO, workoutAssignmentsQO,
  exercisesQO, athletesQO, teamsQO, liftsQO, repMaxesQO,
  athleteDisplayName,
  type Workout, type WorkoutExercise, type WorkoutSet, type RepMax,
} from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useNavigate } from "@tanstack/react-router";
import {
  Plus, X, Users, User, Check, ChevronsUpDown, MoreHorizontal,
  GripVertical, Timer, StickyNote, Layers, CalendarDays, Trash2, Copy,
  Dumbbell, Activity, Clock, Target, Send, Eye, ClipboardCheck,
  Loader2,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { duplicateWorkout } from "@/lib/workout-duplicate";



export function WorkoutEditor({ workout, programContext }: {
  workout: Workout;
  /**
   * When present, the editor is being used inside a Program → Session context.
   * The Session Information card and Publish-workflow tabs are hidden, and a
   * single "Publish & Assign" action targets the program's team (or the
   * athletes on that program) automatically.
   */
  programContext?: {
    programId: string;
    teamId: string | null;
    teamName?: string | null;
    /** Duplicates this session as a new sibling Day in the same cycle, instead of the standalone-only Duplicate button's behavior. */
    onDuplicateSession?: () => void;
    duplicatingSession?: boolean;
  };
}) {
  const embedded = !!programContext;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: exercises = [] } = useQuery(exercisesQO);
  const { data: wex = [] } = useQuery(workoutExercisesQO);
  const { data: wsets = [] } = useQuery(workoutSetsQO);
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: assignments = [] } = useQuery(workoutAssignmentsQO);
  const { data: lifts = [] } = useQuery(liftsQO);
  const { data: repMaxes = [] } = useQuery(repMaxesQO);
  const workoutOrgId = workout.organization_id;
  const visibleTeams = useMemo(
    () => teams.filter((t) => t.organization_id === workoutOrgId),
    [teams, workoutOrgId],
  );
  const visibleExercises = useMemo(
    () => exercises.filter((e) => e.organization_id === workoutOrgId),
    [exercises, workoutOrgId],
  );

  const rows = useMemo(() => wex.filter((x) => x.workout_id === workout.id).sort((a, b) => a.position - b.position), [wex, workout.id]);
  const assigns = useMemo(() => assignments.filter((a) => a.workout_id === workout.id), [assignments, workout.id]);
  const setsByExercise = useMemo(() => {
    const m = new Map<string, WorkoutSet[]>();
    for (const s of wsets) {
      const arr = m.get(s.workout_exercise_id) ?? [];
      arr.push(s);
      m.set(s.workout_exercise_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.position - b.position);
    return m;
  }, [wsets]);

  // Group consecutive exercises sharing a superset_group into visual blocks.
  const blocks = useMemo(() => {
    const out: { group: string | null; items: WorkoutExercise[] }[] = [];
    for (const r of rows) {
      const g = r.superset_group || null;
      const last = out[out.length - 1];
      if (g && last && last.group === g) last.items.push(r);
      else out.push({ group: g, items: [r] });
    }
    return out;
  }, [rows]);

  const totalSets = useMemo(
    () => rows.reduce((n, r) => n + (setsByExercise.get(r.id)?.reduce((k, s) => k + (s.sets ?? 0), 0) ?? 0), 0),
    [rows, setsByExercise],
  );

  // ---- Autosave meta ----------------------------------------------------
  // Coach can never lose in-progress edits. We debounce writes 800ms and
  // surface a live Saving / Saved / Unsaved indicator. If the user navigates
  // away while dirty, we flush synchronously on unmount.
  const [meta, setMeta] = useState({
    name: workout.name,
    description: workout.description ?? "",
    notes: workout.notes ?? "",
    team_id: workout.team_id ?? "",
  });
  type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);
  const metaRef = useRef(meta);
  metaRef.current = meta;

  // Baseline that reflects the last remote row. Recompute when the workout
  // prop changes (e.g. after refetch), so navigating between sessions
  // doesn't leave a stale baseline that flags nothing as dirty.
  const baselineRef = useRef({
    name: workout.name,
    description: workout.description ?? "",
    notes: workout.notes ?? "",
    team_id: workout.team_id ?? "",
  });
  useEffect(() => {
    baselineRef.current = {
      name: workout.name,
      description: workout.description ?? "",
      notes: workout.notes ?? "",
      team_id: workout.team_id ?? "",
    };
    setMeta(baselineRef.current);
    setSaveState("idle");
  }, [workout.id, workout.name, workout.description, workout.notes, workout.team_id]);

  const isDirty = (m = metaRef.current) => {
    const b = baselineRef.current;
    return (
      m.name.trim() !== b.name ||
      (m.description.trim() || null) !== (b.description || null) ||
      (m.notes.trim() || null) !== (b.notes || null) ||
      (m.team_id || null) !== (b.team_id || null)
    );
  };

  const flush = async () => {
    if (!isDirty()) return;
    const snapshot = { ...metaRef.current };
    setSaveState("saving");
    const run = (async () => {
      const { error } = await supabase.from("workouts").update({
        name: snapshot.name.trim(),
        description: snapshot.description.trim() || null,
        notes: snapshot.notes.trim() || null,
        team_id: snapshot.team_id || null,
        updated_at: new Date().toISOString(),
      }).eq("id", workout.id);
      if (error) {
        setSaveState("error");
        toast.error(toUserMessage(error));
        return;
      }
      baselineRef.current = {
        name: snapshot.name.trim(),
        description: snapshot.description.trim(),
        notes: snapshot.notes.trim(),
        team_id: snapshot.team_id,
      };
      setLastSavedAt(Date.now());
      // If the user typed again during the save, stay dirty.
      setSaveState(isDirty() ? "dirty" : "saved");
      qc.invalidateQueries({ queryKey: ["workouts"] });
    })();
    inflightRef.current = run;
    await run;
    if (inflightRef.current === run) inflightRef.current = null;
  };

  const scheduleSave = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void flush(); }, 800);
  };

  const patchMeta = (patch: Partial<typeof meta>) => {
    setMeta((prev) => {
      const next = { ...prev, ...patch };
      metaRef.current = next;
      return next;
    });
    setSaveState("dirty");
    scheduleSave();
  };

  // Flush on unmount / navigation so coaches don't lose the last few keystrokes.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (isDirty()) { void flush(); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also flush before the tab is hidden or the window is closed.
  useEffect(() => {
    const onHide = () => { if (isDirty()) void flush(); };
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const duplicate = useMutation({
    mutationFn: () => duplicateWorkout(workout.id),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ["workouts"] });
      qc.invalidateQueries({ queryKey: ["workout_exercises"] });
      qc.invalidateQueries({ queryKey: ["workout_sets"] });
      qc.invalidateQueries({ queryKey: ["program_workouts"] });
      toast.success(`Duplicated as "${w.name}"`);
      navigate({ to: "/workouts/$id", params: { id: w.id } });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });



  const addRow = useMutation({
    mutationFn: async (opts?: { superset_group?: string }) => {
      const nextPos = rows.length ? rows[rows.length - 1].position + 1 : 0;
      const payload: {
        workout_id: string;
        exercise_name: string;
        position: number;
        superset_group?: string;
      } = {
        workout_id: workout.id,
        exercise_name: "",
        position: nextPos,
      };
      if (opts?.superset_group) payload.superset_group = opts.superset_group;
      const { data, error } = await supabase.from("workout_exercises").insert(payload).select().single();
      if (error) throw error;
      const { error: setError } = await supabase.from("workout_sets").insert({
        workout_exercise_id: (data as WorkoutExercise).id, position: 0, sets: 3, reps: "5",
      });
      if (setError) throw setError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workout_exercises"] });
      qc.invalidateQueries({ queryKey: ["workout_sets"] });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const updateRow = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<WorkoutExercise> }) => {
      const { error } = await supabase.from("workout_exercises").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workout_exercises"] }),
  });

  const removeRow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workout_exercises").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workout_exercises"] });
      qc.invalidateQueries({ queryKey: ["workout_sets"] });
    },
  });

  // Persist a new ordering. `orderedIds` is the desired position order.
  // We optimistically write the new positions to the cache so the dragged
  // item stays where the coach dropped it, then confirm each row in the DB.
  const reorderRows = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      // Renumber 1..N and write only rows whose position changed.
      const currentById = new Map(rows.map((r) => [r.id, r.position]));
      const updates = orderedIds
        .map((id, i) => ({ id, position: i + 1 }))
        .filter((u) => currentById.get(u.id) !== u.position);
      const results = await Promise.all(
        updates.map((u) =>
          supabase.from("workout_exercises").update({ position: u.position }).eq("id", u.id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onMutate: async (orderedIds: string[]) => {
      await qc.cancelQueries({ queryKey: ["workout_exercises"] });
      const key = ["workout_exercises"] as const;
      const prev = qc.getQueryData<WorkoutExercise[]>(key);
      if (prev) {
        const posById = new Map(orderedIds.map((id, i) => [id, i + 1]));
        const next = prev.map((r) => (posById.has(r.id) ? { ...r, position: posById.get(r.id)! } : r));
        qc.setQueryData<WorkoutExercise[]>(key, next);
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["workout_exercises"], ctx.prev);
      toast.error(toUserMessage(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["workout_exercises"] }),
  });


  const bestLift = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lifts) {
      if (!l.load) continue;
      const k = `${l.athlete_id}::${l.exercise.toLowerCase()}`;
      map.set(k, Math.max(map.get(k) ?? 0, l.load));
    }
    return map;
  }, [lifts]);

  // ---- Derived session summary ------------------------------------------
  const totalReps = useMemo(() => {
    let n = 0;
    for (const r of rows) for (const s of setsByExercise.get(r.id) ?? []) {
      const reps = Number((s.reps ?? "").toString().split(/[^0-9]/)[0] || 0);
      n += (s.sets ?? 0) * reps;
    }
    return n;
  }, [rows, setsByExercise]);

  const estMinutes = useMemo(() => {
    // rough: 45s per rep of work + rest × sets, floor at 10min
    let sec = 0;
    for (const r of rows) for (const s of setsByExercise.get(r.id) ?? []) {
      const sets = s.sets ?? 0;
      const restEach = r.rest_seconds ?? 90;
      sec += sets * (restEach + 25);
    }
    return Math.max(10, Math.round(sec / 60));
  }, [rows, setsByExercise]);

  const primaryFocus = useMemo<{ label: string; tone: string }>(() => {
    let percentOrRm = 0, seconds = 0, inches = 0, load = 0;
    for (const r of rows) for (const s of setsByExercise.get(r.id) ?? []) {
      if (s.rm_reps != null || s.percent != null) percentOrRm++;
      else if (s.time_seconds != null) seconds++;
      else if (s.distance_in != null) inches++;
      else if (s.load != null) load++;
    }
    if (percentOrRm >= Math.max(seconds, inches, load)) return { label: "Strength", tone: "text-primary" };
    if (seconds > Math.max(inches, load, percentOrRm)) return { label: "Conditioning", tone: "text-[color:var(--status-info,theme(colors.sky.500))]" };
    if (inches > Math.max(seconds, load, percentOrRm)) return { label: "Plyometrics", tone: "text-[color:var(--status-near)]" };
    if (load > 0) return { label: "Accessory", tone: "text-muted-foreground" };
    return { label: "Unprogrammed", tone: "text-muted-foreground" };
  }, [rows, setsByExercise]);

  const teamName = visibleTeams.find((t) => t.id === meta.team_id)?.name ?? "All teams";

  // ---- Program-context "Publish & Assign" ------------------------------
  // When the editor is opened inside a program session we skip the manual
  // assignments UI and give the coach one button that pushes this session to
  // the program's team (or the athletes tagged with that program) on the
  // chosen date. Idempotent — duplicate-day inserts collapse via the
  // partial UNIQUE index on workout_assignments.
  const [publishDate, setPublishDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const programAthletes = useMemo(
    () => (programContext ? athletes.filter((a) => a.program_id === programContext.programId) : []),
    [athletes, programContext],
  );
  const publishTargetLabel = programContext
    ? programContext.teamId
      ? `team ${programContext.teamName ?? "—"}`
      : programAthletes.length > 0
        ? `${programAthletes.length} athlete${programAthletes.length === 1 ? "" : "s"}`
        : "no athletes yet"
    : "";
  const canPublish = !!programContext && rows.length > 0 && (
    !!programContext.teamId || programAthletes.length > 0
  );
  const publish = useMutation({
    mutationFn: async () => {
      if (!programContext) throw new Error("No program context");
      if (rows.length === 0) throw new Error("Add at least one exercise before publishing.");
      const rowsToInsert: { workout_id: string; team_id: string | null; athlete_id: string | null; scheduled_date: string }[] = [];
      if (programContext.teamId) {
        rowsToInsert.push({ workout_id: workout.id, team_id: programContext.teamId, athlete_id: null, scheduled_date: publishDate });
      } else if (programAthletes.length > 0) {
        for (const a of programAthletes) {
          rowsToInsert.push({ workout_id: workout.id, team_id: null, athlete_id: a.id, scheduled_date: publishDate });
        }
      } else {
        throw new Error("This program has no team and no athletes. Assign a team or athletes to the program first.");
      }
      // Best-effort: existing partial UNIQUE index on
      // (workout_id, athlete|team, scheduled_date) will 23505 on duplicates.
      // Skip existing ones to keep this idempotent.
      const existing = new Set(
        assigns
          .filter((a) => a.scheduled_date === publishDate)
          .map((a) => `${a.team_id ?? ""}|${a.athlete_id ?? ""}`),
      );
      const fresh = rowsToInsert.filter((r) => !existing.has(`${r.team_id ?? ""}|${r.athlete_id ?? ""}`));
      if (fresh.length === 0) return { count: 0, skipped: rowsToInsert.length };
      const { error } = await supabase.from("workout_assignments").insert(fresh);
      if (error) throw error;
      return { count: fresh.length, skipped: rowsToInsert.length - fresh.length };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["workout_assignments"] });
      if (res.count === 0) toast.info("Already published for that date.");
      else toast.success(`Published to ${res.count} target${res.count === 1 ? "" : "s"}${res.skipped ? ` (${res.skipped} already assigned)` : ""}.`);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });
  const publishedForDate = useMemo(
    () => assigns.filter((a) => a.scheduled_date === publishDate).length,
    [assigns, publishDate],
  );



  return (
    <div className="space-y-4 pb-24">
      {/* ============ SECTION 1 · Session Information (standalone only) ============ */}
      {!embedded && (
      <section className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <header className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-4 py-2">
          <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Session Information</h2>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => duplicate.mutate()}
              disabled={duplicate.isPending}
              title="Copy this session — exercises, sets, and prescriptions"
            >
              <Copy className="h-3 w-3" /> Duplicate
            </Button>
            <SaveIndicator state={saveState} lastSavedAt={lastSavedAt} onFlush={() => void flush()} />
          </div>
        </header>
        <div className="grid gap-x-4 gap-y-3 px-4 py-4 md:grid-cols-[1.5fr_1fr]">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Session name</Label>
            <Input
              value={meta.name}
              onChange={(e) => patchMeta({ name: e.target.value })}
              onBlur={() => void flush()}
              className="h-10 font-display text-lg tracking-tight"
              placeholder="Lower Body Strength — Week 1"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Team</Label>
            <Select value={meta.team_id || "none"} onValueChange={(v) => patchMeta({ team_id: v === "none" ? "" : v })}>
              <SelectTrigger className="h-10 text-sm">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All teams</SelectItem>
                {visibleTeams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Description</Label>
            <Textarea rows={2} value={meta.description} onChange={(e) => patchMeta({ description: e.target.value })} onBlur={() => void flush()} className="resize-none text-sm" placeholder="What is this session about?" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Coach notes</Label>
            <Textarea rows={2} value={meta.notes} onChange={(e) => patchMeta({ notes: e.target.value })} onBlur={() => void flush()} className="resize-none text-sm" placeholder="Cues, priorities, autoregulation…" />
          </div>
        </div>
        {/* Summary strip */}
        <div className="grid grid-cols-2 divide-x divide-border/60 border-t border-border/60 bg-muted/20 sm:grid-cols-5">
          <SummaryCell icon={<Layers className="h-3 w-3" />} label="Exercises" value={rows.length} />
          <SummaryCell icon={<Dumbbell className="h-3 w-3" />} label="Total sets" value={totalSets} />
          <SummaryCell icon={<Activity className="h-3 w-3" />} label="Total reps" value={totalReps || "—"} />
          <SummaryCell icon={<Clock className="h-3 w-3" />} label="Est. duration" value={`~${estMinutes} min`} />
          <SummaryCell icon={<Target className="h-3 w-3" />} label="Focus" value={<span className={primaryFocus.tone}>{primaryFocus.label}</span>} />
        </div>
      </section>
      )}

      {/* ============ SECTION 2 · Training Blocks / Timeline ============ */}
      <section className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <header className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-4 py-2">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Training Blocks</h2>
          <span className="text-[11px] text-muted-foreground/70">
            · {blocks.length} block{blocks.length === 1 ? "" : "s"} · {rows.length} exercise{rows.length === 1 ? "" : "s"} · {totalSets} sets
          </span>
          {rows.length > 0 && (
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => addRow.mutate({ superset_group: nextSupersetGroup(rows) })} disabled={addRow.isPending}>
                <Layers className="h-3.5 w-3.5" /> Superset
              </Button>
              <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => addRow.mutate(undefined)} disabled={addRow.isPending}>
                <Plus className="h-3.5 w-3.5" /> Exercise
              </Button>
            </div>
          )}
        </header>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
              <Dumbbell className="h-5 w-5" />
            </div>
            <div className="text-sm font-medium">Start building the session</div>
            <p className="max-w-sm text-xs text-muted-foreground">
              Add exercises one by one, or group them into supersets to train back-to-back. Prescribe sets, reps, load, tempo, and rest on each card.
            </p>
            <Button size="sm" className="mt-1 h-8 text-xs" onClick={() => addRow.mutate(undefined)}>
              <Plus className="h-3.5 w-3.5" /> Add first exercise
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div
                className={cn(
                  "grid items-center gap-2 border-b border-border/50 bg-muted/40 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
                  EXROW_COLS,
                )}
              >
                <span>#</span>
                <span>SS</span>
                <span>Exercise</span>
                <span>Sets</span>
                <span>Reps</span>
                <span>Load type</span>
                <span>Prescription</span>
                <span title="Target bar velocity (m/s)">Vel</span>
                <span />
                <span />
              </div>
              <ExerciseSortableList
                rows={rows}
                onReorder={(orderedIds) => reorderRows.mutate(orderedIds)}
              >
                {blocks.map((block, blockIdx) => {
                  const startIdx = rows.findIndex((r) => r.id === block.items[0].id);
                  return (
                    <li
                      key={`block-${blockIdx}-${block.items[0].id}`}
                      className={cn(block.group && "border-l-2", block.group && SS_BORDER[block.group])}
                    >
                      <div className="divide-y divide-border/30">
                        {block.items.map((r, i) => (
                          <SortableExerciseRow key={r.id} id={r.id}>
                            <ExerciseBlock
                              index={startIdx + i + 1}
                              row={r}
                              sets={setsByExercise.get(r.id) ?? []}
                              exercises={visibleExercises}
                              organizationId={workoutOrgId}
                              onUpdate={(patch) => updateRow.mutate({ id: r.id, patch })}
                              onRemove={() => removeRow.mutate(r.id)}
                            />
                          </SortableExerciseRow>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ExerciseSortableList>
            </div>
          </div>
        )}
      </section>

      {/* ============ SECTION 3 · Review → Assign → Publish (standalone) ============ */}
      {!embedded && (
      <section className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <header className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-4 py-2">
          <Send className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Publish workflow</h2>
        </header>
        <div className="flex items-center gap-1 border-b border-border/60 px-4 py-2.5">
          <PublishStep n={1} label="Review" icon={<Eye className="h-3 w-3" />} done={rows.length > 0} />
          <StepArrow />
          <PublishStep n={2} label="Assign" icon={<Users className="h-3 w-3" />} done={assigns.length > 0} />
          <StepArrow />
          <PublishStep n={3} label="Live" icon={<Send className="h-3 w-3" />} done={assigns.length > 0} muted={assigns.length === 0} />
          <div className="ml-auto text-[11px] text-muted-foreground">
            {assigns.length === 0
              ? "Not yet published"
              : `Live for ${assigns.length} target${assigns.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <Tabs defaultValue="assignments" className="m-0">
          <TabsList className="w-full justify-start rounded-none border-b border-border/60 bg-transparent p-0">
            <TabsTrigger value="assignments" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-4 py-2 text-xs">
              Assignments {assigns.length > 0 && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{assigns.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="preview" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none px-4 py-2 text-xs">
              Prescribed loads
            </TabsTrigger>
          </TabsList>
          <TabsContent value="assignments" className="m-0">
            <AssignmentsPanel workoutId={workout.id} athletes={athletes} teams={teams} assigns={assigns} exerciseCount={rows.length} />
          </TabsContent>
          <TabsContent value="preview" className="m-0">
            {assigns.length > 0 && rows.length > 0 ? (
              <PrescriptionPreview
                rows={rows}
                setsByExercise={setsByExercise}
                exercises={visibleExercises}
                athletes={athletes}
                assigns={assigns}
                bestLift={bestLift}
                repMaxes={repMaxes}
              />
            ) : (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                Assign athletes and add %1RM or rep-max schemes to preview prescribed loads.
              </div>
            )}
          </TabsContent>
        </Tabs>
      </section>
      )}

      {/* ============ Sticky publish bar ============ */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-card/95 shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.08)] backdrop-blur md:left-[var(--sidebar-width,0px)]">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">{meta.name || "Untitled session"}</span>
            <span className="hidden text-muted-foreground sm:inline">
              {rows.length} exercise{rows.length === 1 ? "" : "s"} · {totalSets} set{totalSets === 1 ? "" : "s"}
            </span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SaveIndicator state={saveState} lastSavedAt={lastSavedAt} onFlush={() => void flush()} />
            {embedded ? (
              <>
                {programContext?.onDuplicateSession && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => programContext.onDuplicateSession!()}
                    disabled={programContext.duplicatingSession}
                    title="Duplicate this session as a new Day in the same cycle"
                  >
                    <Copy className="h-3 w-3" /> Duplicate
                  </Button>
                )}
                <Input
                  type="date"
                  value={publishDate}
                  onChange={(e) => setPublishDate(e.target.value)}
                  className="h-8 w-[150px] text-xs"
                  aria-label="Publish date"
                />
                <Button
                  size="sm"
                  className="h-8 gap-1.5 px-3 text-xs font-semibold"
                  onClick={() => publish.mutate()}
                  disabled={!canPublish || publish.isPending}
                  title={
                    !programContext?.teamId && programAthletes.length === 0
                      ? "Assign a team or athletes to this program first"
                      : rows.length === 0
                        ? "Add at least one exercise first"
                        : `Publish to ${publishTargetLabel}`
                  }
                >
                  {publish.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Publish &amp; Assign
                </Button>
                <span className="hidden text-[11px] text-muted-foreground md:inline">
                  → {publishTargetLabel}
                  {publishedForDate > 0 && ` · ${publishedForDate} live`}
                </span>
              </>
            ) : (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
                <Copy className="h-3 w-3" /> Duplicate
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}{label}
      </div>
      <div className="mono-number text-sm font-semibold">{value}</div>
    </div>
  );
}

// ---------- Spreadsheet-style exercise table shared layout ------------------
// One grid column template shared by the header row and every exercise row
// (both the primary row and any extra set-scheme rows) so everything lines
// up like a real spreadsheet: # / SS / Exercise / Sets / Reps / Load type /
// Prescription / Vel / remove-scheme / exercise-menu.
const EXROW_COLS =
  "grid-cols-[26px_46px_minmax(160px,1.4fr)_50px_50px_92px_minmax(90px,1fr)_60px_28px_28px]";

const SS_CELL: Record<string, string> = {
  A: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  B: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  C: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  D: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  E: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
  F: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
};
const SS_BORDER: Record<string, string> = {
  A: "border-orange-500/60",
  B: "border-emerald-500/60",
  C: "border-sky-500/60",
  D: "border-violet-500/60",
  E: "border-pink-500/60",
  F: "border-teal-500/60",
};

// ---------- Sortable exercise list -----------------------------------------
// One flat SortableContext wraps the whole exercise list. Blocks are still
// rendered as grouped `<li>`s for visual clarity, but every exercise row is
// individually sortable across the whole session — including across blocks.
// Superset membership follows `superset_group` on the row; reordering does
// not change grouping.

function ExerciseSortableList({
  rows, onReorder, children,
}: {
  rows: Array<{ id: string; position: number }>;
  onReorder: (orderedIds: string[]) => void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const ids = useMemo(
    () => [...rows].sort((a, b) => a.position - b.position).map((r) => r.id),
    [rows],
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(e: DragEndEvent) => {
        const { active, over } = e;
        if (!over || active.id === over.id) return;
        const oldIdx = ids.indexOf(String(active.id));
        const newIdx = ids.indexOf(String(over.id));
        if (oldIdx < 0 || newIdx < 0) return;
        onReorder(arrayMove(ids, oldIdx, newIdx));
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="divide-y divide-border/50">{children}</ol>
      </SortableContext>
    </DndContext>
  );
}

function SortableExerciseRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 opacity-70")}
    >
      {/* Drag handle — pinned to the row's leading edge so it doesn't fight
          the inline controls inside ExerciseBlock. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder exercise"
        className="absolute -left-1 top-1/2 z-10 grid h-7 w-5 -translate-y-1/2 cursor-grab place-items-center rounded text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="pl-4">{children}</div>
    </div>
  );
}

function SaveIndicator({
  state, lastSavedAt, onFlush,
}: {
  state: "idle" | "dirty" | "saving" | "saved" | "error";
  lastSavedAt: number | null;
  onFlush: () => void;
}) {
  // Nudge a re-render every 30s so the "Saved 2m ago" label stays fresh
  // without a global tick.
  const [, force] = useState(0);
  useEffect(() => {
    if (state !== "saved" || !lastSavedAt) return;
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [state, lastSavedAt]);

  const savedAgo = (() => {
    if (!lastSavedAt) return "";
    const s = Math.round((Date.now() - lastSavedAt) / 1000);
    if (s < 5) return "just now";
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.round(m / 60)}h ago`;
  })();

  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (state === "dirty") {
    return (
      <button
        type="button"
        onClick={onFlush}
        className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/20"
        title="Save now"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Unsaved
      </button>
    );
  }
  if (state === "error") {
    return (
      <button
        type="button"
        onClick={onFlush}
        className="flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/20"
      >
        Save failed — retry
      </button>
    );
  }
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-300">
        <Check className="h-3 w-3" /> Saved{savedAgo ? ` · ${savedAgo}` : ""}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[11px] font-medium text-muted-foreground">
      Autosave on
    </span>
  );
}


function PublishStep({ n, label, icon, done, muted }: { n: number; label: string; icon: React.ReactNode; done: boolean; muted?: boolean }) {
  return (
    <div className={cn(
      "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
      done ? "bg-primary/10 text-primary" : muted ? "text-muted-foreground/60" : "text-muted-foreground",
    )}>
      <span className={cn(
        "grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold",
        done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
      )}>{done ? <Check className="h-2.5 w-2.5" /> : n}</span>
      {icon}
      {label}
    </div>
  );
}

function StepArrow() {
  return <div className="h-px w-4 bg-border" aria-hidden />;
}


function nextSupersetGroup(rows: WorkoutExercise[]): string {
  const used = new Set(rows.map((r) => r.superset_group).filter(Boolean) as string[]);
  for (const g of ["A", "B", "C", "D", "E", "F"]) if (!used.has(g)) return g;
  return "A";
}

function ExerciseBlock({ index, row, sets, exercises, organizationId, onUpdate, onRemove }: {
  index: number;
  row: WorkoutExercise;
  sets: WorkoutSet[];
  exercises: { id: string; name: string; measurement_type?: string | null }[];
  organizationId: string;
  onUpdate: (patch: Partial<WorkoutExercise>) => void;
  onRemove: () => void;
}) {
  const [local, setLocal] = useState({
    exercise_id: row.exercise_id ?? "",
    exercise_name: row.exercise_name ?? "",
    tempo: row.tempo ?? "",
    rest_seconds: row.rest_seconds ?? null as number | null,
    notes: row.notes ?? "",
    superset_group: row.superset_group ?? "",
  });
  const measurement = (local.exercise_id
    ? (exercises.find((e) => e.id === local.exercise_id)?.measurement_type ?? "load")
    : "load") as "load" | "seconds" | "inches" | "reps";

  const commit = (patch: Partial<typeof local>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onUpdate({
      exercise_id: next.exercise_id || null,
      exercise_name: next.exercise_name,
      tempo: next.tempo || null,
      rest_seconds: next.rest_seconds ?? null,
      notes: next.notes || null,
      superset_group: next.superset_group || null,
    });
  };

  const qc = useQueryClient();
  const createExercise = async (name: string): Promise<{ id: string; name: string } | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (!organizationId) {
      toast.error("This workout is missing an organization. Create it from a program, then try again.");
      return null;
    }
    const existing = exercises.find((e) => e.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    const { data, error } = await supabase.from("exercises").insert({ name: trimmed, organization_id: organizationId, is_custom: true } as never).select("id, name").single();
    if (error) { toast.error(toUserMessage(error)); return null; }
    qc.invalidateQueries({ queryKey: ["exercises"] });
    return data as { id: string; name: string };
  };

  // Set-scheme mutations (one exercise can have several: e.g. set 1 at 50%,
  // set 2 at 65%, each its own scheme with sets=1). The first scheme for an
  // exercise defaults to a normal "3x5"; every scheme after that defaults to
  // a single set — that's the whole point of adding another one — and
  // inherits the previous scheme's reps so the coach only has to change load.
  const invalidateSets = () => qc.invalidateQueries({ queryKey: ["workout_sets"] });
  const addSet = useMutation({
    mutationFn: async () => {
      const nextPos = sets.length ? sets[sets.length - 1].position + 1 : 0;
      const prev = sets[sets.length - 1];
      const defaults = prev ? { sets: 1, reps: prev.reps || "5" } : { sets: 3, reps: "5" };
      const { error } = await supabase.from("workout_sets").insert({
        workout_exercise_id: row.id, position: nextPos, ...defaults,
      });
      if (error) throw error;
    },
    onSuccess: invalidateSets,
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });
  const updSet = useMutation({
    // Keystrokes save immediately. Serialize them so a slower earlier request
    // cannot arrive after the final value and overwrite it in the database.
    scope: { id: "workout-set-updates" },
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<WorkoutSet> }) => {
      const { error } = await supabase.from("workout_sets").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateSets,
  });
  const delSet = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workout_sets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateSets,
  });

  const groupCellClass = local.superset_group ? SS_CELL[local.superset_group] : "";

  const identityCells = (
    <>
      <span className="mono-number text-center text-[11px] text-muted-foreground">{index}</span>
      <Select value={local.superset_group || "__none"} onValueChange={(v) => commit({ superset_group: v === "__none" ? "" : v })}>
        <SelectTrigger
          className={cn("h-7 justify-center border-border/60 px-1 text-[11px] font-bold", groupCellClass || "text-muted-foreground")}
          title="Superset group"
        >
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">Solo</SelectItem>
          {["A", "B", "C", "D", "E", "F"].map((g) => (
            <SelectItem key={g} value={g}>SS {g}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ExerciseCombobox
        value={local.exercise_id}
        label={local.exercise_name}
        exercises={exercises}
        onSelect={(ex) => commit({ exercise_id: ex.id, exercise_name: ex.name })}
        onCreate={async (name) => {
          const created = await createExercise(name);
          if (created) commit({ exercise_id: created.id, exercise_name: created.name });
        }}
      />
    </>
  );

  const rowMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Exercise actions">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => addSet.mutate()}>
          <Plus className="mr-2 h-3.5 w-3.5" /> Add set scheme
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRemove} className="text-destructive">
          <Trash2 className="mr-2 h-3.5 w-3.5" /> Remove exercise
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Running "Set N" / "Sets N–M" label per scheme, so a coach building a
  // set-by-set sequence (e.g. set 1 @50%, set 2 @65%) can see exactly which
  // row is which set. Only shown once there's more than one scheme — a
  // single "3x5" scheme doesn't need it.
  const schemeLabels = useMemo(() => {
    if (sets.length < 2) return sets.map(() => undefined);
    let cursor = 1;
    return sets.map((s) => {
      const count = Math.max(1, s.sets ?? 1);
      const label = count === 1 ? `Set ${cursor}` : `Sets ${cursor}–${cursor + count - 1}`;
      cursor += count;
      return label;
    });
  }, [sets]);

  return (
    <div>
      {sets.length === 0 ? (
        <div className={cn("grid items-center gap-2 px-2 py-1.5", EXROW_COLS)}>
          {identityCells}
          <button
            type="button"
            onClick={() => addSet.mutate()}
            className="col-span-5 flex items-center gap-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3 w-3" /> Add set scheme
          </button>
          <span />
          {rowMenu}
        </div>
      ) : (
        sets.map((s, i) => {
          const isLast = i === sets.length - 1;
          return (
            <div
              key={s.id}
              className={cn("grid items-center gap-2 px-2 py-1.5 transition-colors hover:bg-muted/30", EXROW_COLS)}
            >
              {i === 0 ? identityCells : (
                <>
                  <span />
                  <span />
                  <span />
                </>
              )}
              <SetSchemeRow
                set={s}
                exercises={exercises}
                measurement={measurement}
                label={schemeLabels[i]}
                onUpdate={(patch) => updSet.mutate({ id: s.id, patch })}
                onRemove={() => delSet.mutate(s.id)}
              />
              {i === 0 ? rowMenu : isLast ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => addSet.mutate()}
                  title="Add another set (e.g. a different %)"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              ) : <span />}
            </div>
          );
        })
      )}

      {/* Tempo / Rest / Notes — compact, always visible (no collapse to hide behind) */}
      <div className="grid grid-cols-[1fr_1fr_2fr] items-center gap-2 border-t border-border/20 bg-muted/5 px-2 py-1">
        <div className="flex items-center gap-1">
          <span className="shrink-0 text-[9px] uppercase tracking-wider text-muted-foreground">Tempo</span>
          <Input className="h-6 text-[11px]" value={local.tempo ?? ""} onChange={(e) => commit({ tempo: e.target.value })} placeholder="3-0-1" />
        </div>
        <div className="flex items-center gap-1">
          <Timer className="h-3 w-3 shrink-0 text-muted-foreground" />
          <Input className="h-6 text-[11px]" type="number" value={local.rest_seconds ?? ""} onChange={(e) => commit({ rest_seconds: e.target.value ? Number(e.target.value) : null })} placeholder="Rest s" />
        </div>
        <div className="flex items-center gap-1">
          <StickyNote className="h-3 w-3 shrink-0 text-muted-foreground" />
          <Input className="h-6 text-[11px]" value={local.notes ?? ""} onChange={(e) => commit({ notes: e.target.value })} placeholder="Notes / cues" />
        </div>
      </div>
    </div>
  );
}

type SetMode = "load" | "percent" | "rm" | "seconds" | "inches" | "mph";

// Renders just the Sets/Reps/Load-type/Prescription/Vel/Remove cells for one
// set scheme — a bare fragment, not its own grid, so it lines up as trailing
// columns in whatever grid row ExerciseBlock places it in (the primary row,
// alongside the exercise identity cells, or a lean extra-scheme row).
function SetSchemeRow({ set, exercises, measurement, label, onUpdate, onRemove }: {
  set: WorkoutSet;
  exercises: { id: string; name: string }[];
  measurement: "load" | "seconds" | "inches" | "reps" | "mph";
  /** "Set 2" / "Sets 3–5" — shown when an exercise has more than one scheme,
   * so each row's place in the set-by-set sequence is unambiguous. */
  label?: string;
  onUpdate: (patch: Partial<WorkoutSet>) => void;
  onRemove: () => void;
}) {
  const initialMode: SetMode = measurement === "mph"
    ? "mph"
    : measurement === "seconds"
      ? "seconds"
      : measurement === "inches"
        ? "inches"
        : set.rm_reps ? "rm" : set.percent != null ? "percent" : "load";
  const [local, setLocal] = useState({
    sets: (set.sets ?? 3) as number | null,
    reps: set.reps ?? "",
    mode: initialMode,
    load: set.load ?? null as number | null,
    percent: set.percent ?? null as number | null,
    percent_of_exercise_id: set.percent_of_exercise_id ?? "",
    rm_reps: set.rm_reps ?? null as number | null,
    time_seconds: set.time_seconds ?? null as number | null,
    distance_in: set.distance_in ?? null as number | null,
    mph: set.time_seconds && set.distance_in ? Number((((set.distance_in / 12) / 3) / set.time_seconds * 2.0454545).toFixed(2)) : (null as number | null),
    dist_yd: set.distance_in ? Number(((set.distance_in / 36)).toFixed(2)) : (null as number | null),
    target_velocity: (set.target_velocity_min ?? set.target_velocity_max ?? null) as number | null,
    notes: set.notes ?? "",
  });

  const commit = (patch: Partial<typeof local>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    const mphYd = next.dist_yd ?? null;
    const mphSeconds = next.mph && mphYd ? (mphYd * 3) / (next.mph * 1.4666667) : null;
    onUpdate({
      sets: next.sets,
      reps: next.reps || null,
      load: next.mode === "load" ? (next.load ?? null) : null,
      percent: next.mode === "percent" || next.mode === "rm" ? (next.percent ?? null) : null,
      percent_of_exercise_id: next.mode === "percent" || next.mode === "rm" ? (next.percent_of_exercise_id || null) : null,
      rm_reps: next.mode === "rm" ? (next.rm_reps ?? null) : null,
      time_seconds: next.mode === "seconds" ? (next.time_seconds ?? null) : next.mode === "mph" ? (mphSeconds != null ? Number(mphSeconds.toFixed(3)) : null) : null,
      distance_in: next.mode === "inches" ? (next.distance_in ?? null) : next.mode === "mph" ? (mphYd != null ? mphYd * 36 : null) : null,
      target_velocity_min: next.target_velocity ?? null,
      target_velocity_max: next.target_velocity ?? null,
      notes: next.notes || null,
    });
  };

  return (
    <>
      <div className="flex flex-col gap-0.5">
        {label && <span className="truncate text-[9px] font-semibold uppercase tracking-wide text-primary/80">{label}</span>}
        <Input className="h-7 text-xs" type="number" min={1} value={local.sets ?? ""} onChange={(e) => commit({ sets: e.target.value ? Number(e.target.value) : null })} placeholder="Sets" />
      </div>
      <Input className="h-7 text-xs" value={local.reps} onChange={(e) => commit({ reps: e.target.value })} placeholder="Reps" />
      <Select value={local.mode} onValueChange={(v) => commit({ mode: v as SetMode })}>
        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="load">@ Load lb</SelectItem>
          <SelectItem value="percent">@ % 1RM</SelectItem>
          <SelectItem value="rm">@ Rep Max</SelectItem>
          <SelectItem value="seconds">Time (s)</SelectItem>
          <SelectItem value="inches">Height (in)</SelectItem>
          <SelectItem value="mph">Speed (mph)</SelectItem>
        </SelectContent>
      </Select>
      <div>
        {local.mode === "load" && (
          <Input className="h-7 text-xs" type="number" placeholder="lb" value={local.load ?? ""} onChange={(e) => commit({ load: e.target.value ? Number(e.target.value) : null })} />
        )}
        {local.mode === "seconds" && (
          <Input className="h-7 text-xs" type="number" step="0.01" placeholder="Target time (s)" value={local.time_seconds ?? ""} onChange={(e) => commit({ time_seconds: e.target.value ? Number(e.target.value) : null })} />
        )}
        {local.mode === "inches" && (
          <Input className="h-7 text-xs" type="number" step="0.1" placeholder="Height / dist (in)" value={local.distance_in ?? ""} onChange={(e) => commit({ distance_in: e.target.value ? Number(e.target.value) : null })} />
        )}
        {local.mode === "mph" && (
          <div className="grid grid-cols-2 gap-1">
            <Input className="h-7 text-xs" type="number" step="0.1" placeholder="mph" value={local.mph ?? ""} onChange={(e) => commit({ mph: e.target.value ? Number(e.target.value) : null })} />
            <Input className="h-7 text-xs" type="number" step="1" placeholder="Dist (yd)" value={local.dist_yd ?? ""} onChange={(e) => commit({ dist_yd: e.target.value ? Number(e.target.value) : null })} />
          </div>
        )}
        {local.mode === "percent" && (
          <div className="grid grid-cols-[60px_1fr] gap-1">
            <Input className="h-7 text-xs" type="number" placeholder="%" value={local.percent ?? ""} onChange={(e) => commit({ percent: e.target.value ? Number(e.target.value) : null })} />
            <Select value={local.percent_of_exercise_id || "none"} onValueChange={(v) => commit({ percent_of_exercise_id: v === "none" ? "" : v })}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Ref" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— self</SelectItem>
                {exercises.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {local.mode === "rm" && (
          <div className="grid grid-cols-[50px_50px_1fr] gap-1">
            <Input className="h-7 text-xs" type="number" min={1} placeholder="RM" value={local.rm_reps ?? ""} onChange={(e) => commit({ rm_reps: e.target.value ? Number(e.target.value) : null })} />
            <Input className="h-7 text-xs" type="number" placeholder="%" value={local.percent ?? ""} onChange={(e) => commit({ percent: e.target.value ? Number(e.target.value) : null })} />
            <Select value={local.percent_of_exercise_id || "none"} onValueChange={(v) => commit({ percent_of_exercise_id: v === "none" ? "" : v })}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Ref" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— self</SelectItem>
                {exercises.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <Input
        className="h-7 text-xs tabular-nums"
        type="number"
        step="0.01"
        min={0}
        placeholder="—"
        value={local.target_velocity ?? ""}
        onChange={(e) => commit({ target_velocity: e.target.value ? Number(e.target.value) : null })}
      />
      <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={onRemove} title="Remove this set scheme">
        <X className="h-3 w-3" />
      </Button>
    </>
  );
}


function AssignmentsPanel({ workoutId, athletes, teams, assigns, exerciseCount }: {
  workoutId: string;
  athletes: { id: string; name: string; first_name: string | null; last_name: string | null; preferred_name: string | null; team_id: string | null }[];
  teams: { id: string; name: string }[];
  assigns: { id: string; athlete_id: string | null; team_id: string | null; scheduled_date: string; status: string }[];
  exerciseCount: number;
}) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<string>("");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const add = useMutation({
    mutationFn: async () => {
      if (exerciseCount === 0) throw new Error("Add at least one exercise before assigning this session.");
      if (!target) throw new Error("Pick an athlete or team");
      const [kind, id] = target.split(":");
      const payload = {
        workout_id: workoutId,
        athlete_id: kind === "athlete" ? id : null,
        team_id: kind === "team" ? id : null,
        scheduled_date: date,
      };
      const { error } = await supabase.from("workout_assignments").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["workout_assignments"] }); toast.success("Assigned"); setTarget(""); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workout_assignments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workout_assignments"] }),
  });

  return (
    <div>
      {exerciseCount === 0 && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-300">
          This session is empty. Add at least one exercise before assigning it to an athlete or team.
        </div>
      )}
      <div className="grid gap-2 border-b border-border/50 bg-muted/20 px-3 py-2 sm:grid-cols-[1fr_150px_auto]">
        <Select value={target} onValueChange={setTarget} disabled={exerciseCount === 0}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Athlete or team…" /></SelectTrigger>
          <SelectContent>
            {teams.map((t) => <SelectItem key={`t-${t.id}`} value={`team:${t.id}`}>Team · {t.name}</SelectItem>)}
            {athletes.map((a) => <SelectItem key={`a-${a.id}`} value={`athlete:${a.id}`}>{athleteDisplayName(a)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-xs" disabled={exerciseCount === 0} />
        <Button
          size="sm"
          className="h-8"
          onClick={() => add.mutate()}
          disabled={add.isPending || !target || exerciseCount === 0}
          title={exerciseCount === 0 ? "Add an exercise first" : undefined}
        >
          <Plus className="h-3.5 w-3.5" /> Assign
        </Button>
      </div>
      {assigns.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          Not assigned yet. Pick an athlete or team above to schedule this session.
        </div>
      ) : (
        <ul className="divide-y divide-border/40">
          {assigns.map((a) => {
            const team = a.team_id ? teams.find((t) => t.id === a.team_id) : null;
            const ath = a.athlete_id ? athletes.find((x) => x.id === a.athlete_id) : null;
            return (
              <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  {team ? <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <span className="truncate font-medium">{team ? `Team · ${team.name}` : ath ? athleteDisplayName(ath) : "?"}</span>
                  <Badge variant="outline" className="tabular-nums text-[10px]">{a.scheduled_date}</Badge>
                  <Badge variant="secondary" className="text-[10px] capitalize">{a.status}</Badge>
                </div>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(a.id)}>
                  <X className="h-3 w-3" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function estimate1RM(load: number, reps: number) {
  return estimate1RMShared(load, reps, getOrg1RMFormula()) ?? load;
}

function lookup1RM(athleteId: string, exName: string, repMaxes: RepMax[], bestLift: Map<string, number>): number | null {
  const key = exName.toLowerCase();
  const own = repMaxes.filter((r) => r.athlete_id === athleteId && r.exercise_name.toLowerCase() === key);
  const rm1 = own.find((r) => r.reps === 1);
  if (rm1) return Number(rm1.load);
  if (own.length) return Math.max(...own.map((r) => estimate1RM(Number(r.load), r.reps)));
  return bestLift.get(`${athleteId}::${key}`) ?? null;
}

function lookupRM(athleteId: string, exName: string, reps: number, repMaxes: RepMax[]): number | null {
  const key = exName.toLowerCase();
  const own = repMaxes.filter((r) => r.athlete_id === athleteId && r.exercise_name.toLowerCase() === key);
  if (!own.length) return null;
  const exact = own.find((r) => r.reps === reps);
  if (exact) return Number(exact.load);
  return Number(own.slice().sort((a, b) => Math.abs(a.reps - reps) - Math.abs(b.reps - reps))[0].load);
}

function resolveLoad(athleteId: string, ex: WorkoutExercise, s: WorkoutSet, exercises: { id: string; name: string }[], repMaxes: RepMax[], bestLift: Map<string, number>): number | null {
  if (s.load != null) return Number(s.load);
  const refName = s.percent_of_exercise_id ? exercises.find((e) => e.id === s.percent_of_exercise_id)?.name ?? "" : ex.exercise_name;
  if (!refName) return null;
  if (s.rm_reps) {
    const base = lookupRM(athleteId, refName, s.rm_reps, repMaxes);
    if (base == null) return null;
    return base * ((s.percent ?? 100) / 100);
  }
  if (s.percent != null) {
    const oneRm = lookup1RM(athleteId, refName, repMaxes, bestLift);
    if (oneRm == null) return null;
    return oneRm * (s.percent / 100);
  }
  return null;
}

function PrescriptionPreview({ rows, setsByExercise, exercises, athletes, assigns, bestLift, repMaxes }: {
  rows: WorkoutExercise[];
  setsByExercise: Map<string, WorkoutSet[]>;
  exercises: { id: string; name: string }[];
  athletes: { id: string; name: string; first_name: string | null; last_name: string | null; preferred_name: string | null; team_id: string | null }[];
  assigns: { athlete_id: string | null; team_id: string | null }[];
  bestLift: Map<string, number>;
  repMaxes: RepMax[];
}) {
  const targetIds = new Set<string>();
  for (const a of assigns) {
    if (a.athlete_id) targetIds.add(a.athlete_id);
    else if (a.team_id) athletes.filter((x) => x.team_id === a.team_id).forEach((x) => targetIds.add(x.id));
  }
  const targets = athletes.filter((a) => targetIds.has(a.id));
  const cols: { row: WorkoutExercise; set: WorkoutSet }[] = [];
  for (const r of rows) for (const s of setsByExercise.get(r.id) ?? []) cols.push({ row: r, set: s });
  const needsCompute = cols.some(({ set }) => set.percent != null || set.rm_reps != null);
  if (targets.length === 0 || cols.length === 0 || !needsCompute) {
    return (
      <div className="px-3 py-8 text-center text-xs text-muted-foreground">
        Assign athletes and add %1RM or rep-max schemes to preview prescribed loads.
      </div>
    );
  }

  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-xs tabular-nums">
        <thead className="sticky top-0 bg-card/90 backdrop-blur">
          <tr className="border-b border-border/60">
            <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Athlete
            </th>
            {cols.map(({ row, set }) => (
              <th key={set.id} className="px-2.5 py-1.5 text-left">
                <div className="text-[11px] font-semibold">{row.exercise_name || "?"}</div>
                <div className="text-[10px] font-normal text-muted-foreground">
                  {set.sets ?? "?"}×{set.reps || "?"} {set.rm_reps ? `@${set.rm_reps}RM` : set.percent != null ? `@${set.percent}%` : set.load != null ? `@${set.load}lb` : ""}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {targets.map((ath) => (
            <tr key={ath.id} className="hover:bg-muted/40">
              <td className="px-2.5 py-1.5 font-medium">{athleteDisplayName(ath)}</td>
              {cols.map(({ row, set }) => {
                const load = resolveLoad(ath.id, row, set, exercises, repMaxes, bestLift);
                const rounded = load ? Math.round(load / 5) * 5 : null;
                return (
                  <td key={set.id} className="mono-number px-2.5 py-1.5">
                    {rounded ? `${rounded} lb` : <span className="text-muted-foreground/60">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExerciseCombobox({ value, label, exercises, onSelect, onCreate }: {
  value: string;
  label: string;
  exercises: { id: string; name: string }[];
  onSelect: (ex: { id: string; name: string }) => void;
  onCreate: (name: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pendingCreate, setPendingCreate] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const trimmed = query.trim();
  const exact = trimmed
    ? exercises.find((e) => e.name.toLowerCase() === trimmed.toLowerCase())
    : null;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "h-8 w-full justify-between rounded-sm px-2 text-sm font-medium hover:bg-muted",
              !label && "text-muted-foreground",
            )}
          >
            <span className="truncate">{label || "Select exercise…"}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Search or type new…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>
                {trimmed ? (
                  <button
                    type="button"
                    className="mx-2 my-1 flex w-[calc(100%-1rem)] items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => { setPendingCreate(trimmed); setOpen(false); }}
                  >
                    <Plus className="h-4 w-4" /> Add "{trimmed}" to library
                  </button>
                ) : (
                  <div className="py-4 text-center text-sm text-muted-foreground">No exercises yet.</div>
                )}
              </CommandEmpty>
              <CommandGroup>
                {exercises.map((ex) => (
                  <CommandItem
                    key={ex.id}
                    value={ex.name}
                    onSelect={() => { onSelect(ex); setOpen(false); setQuery(""); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === ex.id ? "opacity-100" : "opacity-0")} />
                    {ex.name}
                  </CommandItem>
                ))}
                {trimmed && !exact && (
                  <CommandItem
                    value={`__create_${trimmed}`}
                    onSelect={() => { setPendingCreate(trimmed); setOpen(false); }}
                  >
                    <Plus className="mr-2 h-4 w-4" /> Add "{trimmed}" to library
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <AlertDialog open={pendingCreate !== null} onOpenChange={(v) => { if (!v) setPendingCreate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add "{pendingCreate}" to your exercise library?</AlertDialogTitle>
            <AlertDialogDescription>
              This will save "{pendingCreate}" as a custom exercise for your organization so you can reuse it in future workouts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={creating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={creating}
              onClick={async (e) => {
                e.preventDefault();
                if (!pendingCreate) return;
                setCreating(true);
                try {
                  await onCreate(pendingCreate);
                  setQuery("");
                  setPendingCreate(null);
                } finally {
                  setCreating(false);
                }
              }}
            >
              {creating ? "Adding…" : "Add to library"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
