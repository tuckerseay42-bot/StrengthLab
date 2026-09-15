import { supabase } from "@/integrations/supabase/client";
import type { Workout, WorkoutExercise, WorkoutSet } from "@/lib/queries";

/**
 * Duplicate a workout: copies the workout row, all workout_exercises,
 * all workout_sets (with foreign keys remapped), and re-attaches the new
 * workout to every program the source was in. Assignments are intentionally
 * NOT copied — schedules belong to the original session.
 *
 * Returns the newly created workout row.
 */
export async function duplicateWorkout(sourceId: string, opts?: { name?: string }): Promise<Workout> {
  // 1) Fetch source workout row
  const { data: src, error: srcErr } = await supabase
    .from("workouts")
    .select("*")
    .eq("id", sourceId)
    .single();
  if (srcErr) throw srcErr;
  const source = src as Workout;

  // 2) Insert new workout
  const newName = (opts?.name ?? `${source.name} (copy)`).slice(0, 200);
  const { data: created, error: insErr } = await supabase
    .from("workouts")
    .insert({
      name: newName,
      description: source.description,
      notes: source.notes,
      team_id: source.team_id,
      organization_id: source.organization_id,
    } as never)
    .select()
    .single();
  if (insErr) throw insErr;
  const newWorkout = created as Workout;

  // 3) Copy workout_exercises
  const { data: exRows, error: exErr } = await supabase
    .from("workout_exercises")
    .select("*")
    .eq("workout_id", sourceId)
    .order("position", { ascending: true });
  if (exErr) throw exErr;
  const exercises = (exRows ?? []) as WorkoutExercise[];

  const idMap = new Map<string, string>();
  if (exercises.length > 0) {
    const payload = exercises.map((e) => ({
      workout_id: newWorkout.id,
      block_id: e.block_id,
      exercise_id: e.exercise_id,
      exercise_name: e.exercise_name,
      position: e.position,
      sets: e.sets,
      reps: e.reps,
      load: e.load,
      percent_of_exercise_id: e.percent_of_exercise_id,
      percent: e.percent,
      tempo: e.tempo,
      rest_seconds: e.rest_seconds,
      notes: e.notes,
      target_velocity_min: e.target_velocity_min,
      target_velocity_max: e.target_velocity_max,
      superset_group: e.superset_group,
    }));
    const { data: newEx, error: newExErr } = await supabase
      .from("workout_exercises")
      .insert(payload as never)
      .select("id, position");
    if (newExErr) throw newExErr;
    // Pair source -> new by position (bulk insert preserves order but position is authoritative)
    const newByPos = new Map<number, string>();
    for (const r of (newEx ?? []) as { id: string; position: number }[]) {
      newByPos.set(r.position, r.id);
    }
    for (const e of exercises) {
      const nid = newByPos.get(e.position);
      if (nid) idMap.set(e.id, nid);
    }
  }

  // 4) Copy workout_sets, remapping workout_exercise_id
  if (idMap.size > 0) {
    const sourceExIds = Array.from(idMap.keys());
    const { data: setRows, error: setErr } = await supabase
      .from("workout_sets")
      .select("*")
      .in("workout_exercise_id", sourceExIds);
    if (setErr) throw setErr;
    const sets = (setRows ?? []) as WorkoutSet[];
    if (sets.length > 0) {
      const setPayload = sets
        .map((s) => {
          const newExId = idMap.get(s.workout_exercise_id);
          if (!newExId) return null;
          return {
            workout_exercise_id: newExId,
            position: s.position,
            sets: s.sets,
            reps: s.reps,
            load: s.load,
            percent: s.percent,
            percent_of_exercise_id: s.percent_of_exercise_id,
            rm_reps: s.rm_reps,
            target_velocity_min: s.target_velocity_min,
            target_velocity_max: s.target_velocity_max,
            time_seconds: s.time_seconds,
            distance_in: s.distance_in,
            notes: s.notes,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);
      if (setPayload.length > 0) {
        const { error: insSetsErr } = await supabase
          .from("workout_sets")
          .insert(setPayload as never);
        if (insSetsErr) throw insSetsErr;
      }
    }
  }

  // 5) Re-attach to the same programs the source was in
  const { data: pwRows, error: pwErr } = await supabase
    .from("program_workouts")
    .select("program_id, week, day, position")
    .eq("workout_id", sourceId);
  if (pwErr) throw pwErr;
  const pws = (pwRows ?? []) as { program_id: string; week: number | null; day: number | null; position: number | null }[];
  if (pws.length > 0) {
    const pwPayload = pws.map((r) => ({
      program_id: r.program_id,
      workout_id: newWorkout.id,
      week: r.week,
      day: r.day,
      position: (r.position ?? 0) + 1,
    }));
    const { error: pwInsErr } = await supabase.from("program_workouts" as never).insert(pwPayload as never);
    if (pwInsErr) throw pwInsErr;
  }

  return newWorkout;
}
