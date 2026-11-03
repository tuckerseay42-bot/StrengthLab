// Athlete-first workout resolver: given an athlete and a date, figure out
// which workout the athlete is expected to run based on their team's
// assignments and program.
import type {
  Athlete,
  Program,
  ProgramWorkout,
  WorkoutAssignment,
  AthleteTeam,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from "@/lib/queries";

export type ResolvedWorkout = {
  workoutId: string | null;
  teamId: string | null;
  source: "assignment_athlete" | "assignment_team" | "program" | "none";
};

export type ResolverInputs = {
  assignments: WorkoutAssignment[];
  programs: Program[];
  programWorkouts: ProgramWorkout[];
  athleteTeams: AthleteTeam[];
};

export function teamIdsForAthlete(a: Athlete, athleteTeams: AthleteTeam[]): string[] {
  const set = new Set<string>();
  if (a.team_id) set.add(a.team_id);
  for (const at of athleteTeams) if (at.athlete_id === a.id) set.add(at.team_id);
  return Array.from(set);
}

export function resolveAthleteWorkout(
  athlete: Athlete,
  date: string,
  inputs: ResolverInputs,
): ResolvedWorkout {
  const { assignments, programs, programWorkouts, athleteTeams } = inputs;
  const teamIds = teamIdsForAthlete(athlete, athleteTeams);

  // 1) Direct athlete assignment
  const athAssign = assignments.find(
    (w) => w.athlete_id === athlete.id && w.scheduled_date === date,
  );
  if (athAssign) {
    return {
      workoutId: athAssign.workout_id,
      teamId: athlete.team_id,
      source: "assignment_athlete",
    };
  }

  // 2) Team assignment for one of the athlete's teams
  const teamAssign = assignments.find(
    (w) => w.team_id && teamIds.includes(w.team_id) && w.scheduled_date === date,
  );
  if (teamAssign) {
    return {
      workoutId: teamAssign.workout_id,
      teamId: teamAssign.team_id,
      source: "assignment_team",
    };
  }

  // 3) Program fallback (athlete's assigned program, first workout)
  if (athlete.program_id) {
    const start = athlete.program_start_date
      ? new Date(athlete.program_start_date)
      : null;
    const now = new Date(date + "T00:00:00");
    let week = 1;
    let day = 1;
    if (start && !Number.isNaN(start.getTime())) {
      const diffDays = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000));
      week = Math.floor(diffDays / 7) + 1;
      day = (diffDays % 7) + 1;
    }
    const program = programs.find((p) => p.id === athlete.program_id);
    const pws = programWorkouts
      .filter((pw) => pw.program_id === athlete.program_id)
      .sort((a, b) => a.week - b.week || a.day - b.day || a.position - b.position);
    // Try exact week/day, then closest earlier, else first row
    const exact = pws.find((pw) => pw.week === week && pw.day === day);
    const fallback = exact ?? pws[0] ?? null;
    if (fallback) {
      return {
        workoutId: fallback.workout_id,
        teamId: athlete.team_id ?? program?.team_id ?? null,
        source: "program",
      };
    }
  }

  return { workoutId: null, teamId: athlete.team_id, source: "none" };
}

/**
 * Expands a workout's exercises/set-schemes into one row per individual
 * set — e.g. a "3 sets of 4" scheme row becomes 3 rows — so callers can
 * count "how many sets does this workout actually have" and compare
 * against logged sets. Shared by Live Training's per-athlete progress and
 * anything else (e.g. the rack display board) that needs to know whether
 * an athlete has finished today's session.
 */
export function buildPrescribedSets(
  workout: Workout | null,
  workoutExercises: WorkoutExercise[],
  workoutSets: WorkoutSet[],
): Array<{
  exercise: WorkoutExercise;
  setPosition: number;
  setTotal: number;
  setRow: WorkoutSet | null;
}> {
  if (!workout) return [];
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
}
