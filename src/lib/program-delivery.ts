// Program Delivery: assembles a program session's content + roster + rack
// groupings for printing/presenting, independent of the authoring UI in
// workout-editor.tsx (whose grouping algorithm this mirrors).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Athlete, AthleteTeam, WorkoutExercise, WorkoutSet } from "@/lib/queries";
import { filterAthletes, emptyFilters } from "@/components/filters";

export type ExerciseBlock = { group: string | null; items: WorkoutExercise[] };

/** Group consecutive exercises sharing a superset_group into visual blocks — same rule as workout-editor.tsx. */
export function groupExercisesBySuperset(rows: WorkoutExercise[]): ExerciseBlock[] {
  const out: ExerciseBlock[] = [];
  for (const r of rows) {
    const g = r.superset_group || null;
    const last = out[out.length - 1];
    if (g && last && last.group === g) last.items.push(r);
    else out.push({ group: g, items: [r] });
  }
  return out;
}

export function blockLabel(block: ExerciseBlock, blockIdx: number): string {
  return block.group ? `SS ${block.group}` : `#${blockIdx + 1}`;
}

/** Roster of a team, unioning the primary Athlete.team_id and athlete_teams rows — same rule as attendance.tsx / training-resolver.ts. */
export function rosterForTeam(
  athletes: Athlete[],
  athleteTeams: AthleteTeam[],
  teamId: string | null,
): Athlete[] {
  if (!teamId) return [];
  const byAthlete = new Map<string, Set<string>>();
  for (const at of athleteTeams) {
    const s = byAthlete.get(at.athlete_id) ?? new Set<string>();
    s.add(at.team_id);
    byAthlete.set(at.athlete_id, s);
  }
  return filterAthletes(athletes, emptyFilters, teamId, byAthlete);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** A single workout's exercises + sets, fetched scoped to that workout (queries.ts's workoutExercisesQO/workoutSetsQO are unscoped globals — too heavy here). */
export function sessionWorkoutContentQO(workoutId: string | null) {
  return queryOptions({
    queryKey: ["program-delivery-workout-content", workoutId],
    queryFn: async (): Promise<{ exercises: WorkoutExercise[]; sets: WorkoutSet[] }> => {
      if (!workoutId) return { exercises: [], sets: [] };
      const { data: exercises, error: exErr } = await supabase
        .from("workout_exercises")
        .select("*")
        .eq("workout_id", workoutId)
        .order("position");
      if (exErr) throw exErr;
      const exList = (exercises ?? []) as WorkoutExercise[];
      const ids = exList.map((e) => e.id);
      if (ids.length === 0) return { exercises: exList, sets: [] };
      const { data: sets, error: setErr } = await supabase
        .from("workout_sets")
        .select("*")
        .in("workout_exercise_id", ids)
        .order("position");
      if (setErr) throw setErr;
      return { exercises: exList, sets: (sets ?? []) as WorkoutSet[] };
    },
    enabled: !!workoutId,
  });
}

export function setsForExercise(sets: WorkoutSet[], exerciseId: string): WorkoutSet[] {
  return sets
    .filter((s) => s.workout_exercise_id === exerciseId)
    .sort((a, b) => a.position - b.position);
}

/**
 * Generic (non-athlete-specific) prescription text for a set, as authored —
 * e.g. "3 x 5 @ 75%", "3 x 8 @ 185 lb", "3 x 30s". Mirrors the mode-inference
 * in workout-editor.tsx's SetSchemeRow (measurement is ignored here since
 * Program Delivery prints across exercises of mixed measurement types).
 */
export function formatPrescription(exercise: WorkoutExercise, set: WorkoutSet): string {
  const sets = set.sets ?? exercise.sets ?? null;
  const reps = set.reps ?? exercise.reps ?? null;
  const setsReps = [sets != null ? `${sets}x` : null, reps || null].filter(Boolean).join(" ");
  const load = set.load ?? exercise.load ?? null;
  const rmReps = set.rm_reps ?? null;
  const percent = set.percent ?? exercise.percent ?? null;

  let load_part: string | null = null;
  if (load != null) load_part = `${load} lb`;
  else if (rmReps != null && percent != null) load_part = `${percent}% of ${rmReps}RM`;
  else if (percent != null) load_part = `${percent}% 1RM`;
  else if (set.time_seconds != null) load_part = `${set.time_seconds}s`;
  else if (set.distance_in != null) load_part = `${set.distance_in} in`;

  return [setsReps || null, load_part ? `@ ${load_part}` : null].filter(Boolean).join(" ") || "—";
}

/** One rack, and whichever athletes belong to it. */
export type RackGroup = { rackNumber: number; athletes: Athlete[] };

/** Reads persisted rack_sessions/rack_session_athletes for a team + date. Empty when nothing's been assigned yet. */
export function rackGroupsQO(teamId: string | null, sessionDate: string | null) {
  return queryOptions({
    queryKey: ["program-delivery-rack-groups", teamId, sessionDate],
    queryFn: async (): Promise<{ rackNumber: number; athleteIds: string[] }[]> => {
      if (!teamId || !sessionDate) return [];
      const { data: racks, error: rackErr } = await supabase
        .from("rack_sessions")
        .select("id, rack_number")
        .eq("team_id", teamId)
        .eq("session_date", sessionDate)
        .order("rack_number");
      if (rackErr) throw rackErr;
      const rackList = (racks ?? []) as { id: string; rack_number: number }[];
      if (rackList.length === 0) return [];
      const ids = rackList.map((r) => r.id);
      const { data: members, error: memErr } = await supabase
        .from("rack_session_athletes")
        .select("rack_session_id, athlete_id, quadrant")
        .in("rack_session_id", ids)
        .order("quadrant");
      if (memErr) throw memErr;
      const byRackSession = new Map<string, string[]>();
      for (const m of (members ?? []) as { rack_session_id: string; athlete_id: string }[]) {
        const arr = byRackSession.get(m.rack_session_id) ?? [];
        arr.push(m.athlete_id);
        byRackSession.set(m.rack_session_id, arr);
      }
      return rackList.map((r) => ({
        rackNumber: r.rack_number,
        athleteIds: byRackSession.get(r.id) ?? [],
      }));
    },
    enabled: !!teamId && !!sessionDate,
  });
}

/**
 * Resolves the rack layout to print: real persisted assignments when there
 * are genuinely multiple racks with people in them, otherwise an
 * auto-grouped fallback (roster chunked into groups of 4) — today's
 * rack-console hardcodes every team to a single rack, so real multi-rack
 * data mostly won't exist until the dedicated rack-assignment builder ships.
 */
export function resolveRackGroups(
  roster: Athlete[],
  persisted: { rackNumber: number; athleteIds: string[] }[],
): { groups: RackGroup[]; isAutoGrouped: boolean } {
  const byId = new Map(roster.map((a) => [a.id, a]));
  const genuine = persisted.filter((r) => r.athleteIds.length > 0);
  const rackNumbers = new Set(genuine.map((r) => r.rackNumber));
  if (genuine.length > 0 && rackNumbers.size > 1) {
    return {
      isAutoGrouped: false,
      groups: genuine.map((r) => ({
        rackNumber: r.rackNumber,
        athletes: r.athleteIds.map((id) => byId.get(id)).filter((a): a is Athlete => !!a),
      })),
    };
  }
  const sorted = [...roster].sort((a, b) => a.name.localeCompare(b.name));
  return {
    isAutoGrouped: true,
    groups: chunk(sorted, 4).map((athletes, i) => ({ rackNumber: i + 1, athletes })),
  };
}
