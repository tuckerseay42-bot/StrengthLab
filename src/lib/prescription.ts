import type { RepMax, WorkoutExercise, WorkoutSet } from "./queries";
import { estimate1RM, predictRepMax, DEFAULT_1RM_FORMULA, type OneRmFormula } from "./one-rm";

// Canonical e1RM (see src/lib/one-rm.ts + public.estimate_1rm SQL mirror).
export const epley = (load: number, reps: number, formula: OneRmFormula = DEFAULT_1RM_FORMULA) =>
  estimate1RM(load, reps, formula) ?? load;

// Always round DOWN to the nearest 5 lb — no 2.5 lb plates in the weight room.
export const roundToPlate = (n: number, step = 5) =>
  Math.floor(n / step) * step;

/**
 * Best e1RM for an athlete on a given exercise (matches by exercise_id first,
 * falls back to case-insensitive exercise_name).
 */
export function bestE1rm(
  repMaxes: RepMax[],
  athleteId: string,
  exerciseId: string | null,
  exerciseName: string | null,
  formula: OneRmFormula = DEFAULT_1RM_FORMULA,
): { e1rm: number; source: RepMax } | null {
  const nameKey = (exerciseName ?? "").trim().toLowerCase();
  const matches = repMaxes.filter((r) => {
    if (r.athlete_id !== athleteId) return false;
    // Match on id when both sides have one; otherwise fall back to name.
    // Rolled-up rows from `lifts` carry no exercise_id, so an id-only match
    // would silently drop almost every stored max.
    const idMatch = !!exerciseId && r.exercise_id === exerciseId;
    const nameMatch = !!nameKey && (r.exercise_name ?? "").trim().toLowerCase() === nameKey;
    return idMatch || nameMatch;
  });

  // A programmed "% 1RM" must use the athlete's stored 1RM when one exists.
  // Estimating every 2–5RM and taking the largest could let one bad multi-rep
  // log override a coach-edited training max and inflate every prescription.
  const storedOneRm = matches
    .filter((r) => r.reps === 1)
    .reduce<RepMax | null>((best, r) => (!best || Number(r.load) > Number(best.load) ? r : best), null);
  if (storedOneRm) return { e1rm: Number(storedOneRm.load), source: storedOneRm };

  let best = 0;
  let bestRow: RepMax | null = null;
  for (const r of matches) {
    const e = epley(Number(r.load), r.reps, formula);
    if (e > best) { best = e; bestRow = r; }
  }
  return bestRow ? { e1rm: best, source: bestRow } : null;
}

export type SuggestedLoad = {
  load: number;
  basis: "percent" | "rm" | "explicit";
  detail: string;
  source?: RepMax;
} | null;

/**
 * Compute a suggested working load for a prescribed set.
 * Priority: explicit setRow/exercise.load → percent of ref exercise → RM lookup.
 */
export function suggestLoad(params: {
  athleteId: string;
  exercise: Pick<WorkoutExercise, "exercise_id" | "exercise_name" | "load" | "percent" | "percent_of_exercise_id">;
  setRow?: Pick<WorkoutSet, "load" | "percent" | "percent_of_exercise_id" | "rm_reps"> | null;
  repMaxes: RepMax[];
  referenceExerciseName?: string | null;
  step?: number;
  formula?: OneRmFormula;
}): SuggestedLoad {
  const { athleteId, exercise, setRow, repMaxes, referenceExerciseName, step = 5, formula = DEFAULT_1RM_FORMULA } = params;

  const explicit = setRow?.load ?? exercise.load ?? null;
  if (explicit != null) {
    return { load: Number(explicit), basis: "explicit", detail: "prescribed" };
  }

  const refExId = setRow?.percent_of_exercise_id ?? exercise.percent_of_exercise_id ?? exercise.exercise_id ?? null;
  // Only allow the name fallback when the reference IS this exercise; a
  // percent-of-another-lift reference must match by id.
  const refName = !refExId || refExId === exercise.exercise_id
    ? exercise.exercise_name
    : (referenceExerciseName ?? null);

  // Target RM (e.g. 85% of 5RM). Check this before generic %1RM because an
  // RM prescription can intentionally contain both rm_reps and percent.
  const rmReps = setRow?.rm_reps ?? null;
  if (rmReps != null && rmReps > 0) {
    const best = bestE1rm(repMaxes, athleteId, refExId, refName, formula);
    if (!best) return null;
    const predicted = predictRepMax(best.e1rm, rmReps, formula);
    const pct = setRow?.percent ?? 100;
    return {
      load: roundToPlate(predicted * (Number(pct) / 100), step),
      basis: "rm",
      detail: `${pct}% of predicted ${rmReps}RM from e1RM ${Math.round(best.e1rm / 5) * 5} lb`,
      source: best.source,
    };
  }

  // Percent of 1RM
  const pct = setRow?.percent ?? exercise.percent ?? null;
  if (pct != null) {
    const best = bestE1rm(repMaxes, athleteId, refExId, refName, formula);
    if (!best) return null;
    const load = roundToPlate(best.e1rm * (Number(pct) / 100), step);
    return {
      load,
      basis: "percent",
      detail: `${pct}% of 1RM (${Math.round(best.e1rm / 5) * 5} lb)`,
      source: best.source,
    };
  }

  return null;
}
