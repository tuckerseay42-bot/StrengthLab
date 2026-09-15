export const SPORTS = [
  "Football",
  "Boys Basketball", "Girls Basketball",
  "Baseball", "Softball",
  "Boys Soccer", "Girls Soccer",
  "Boys Lacrosse", "Girls Lacrosse",
  "Boys Track & Field", "Girls Track & Field",
  "Boys Cross Country", "Girls Cross Country",
  "Boys Swimming", "Girls Swimming",
  "Boys Tennis", "Girls Tennis",
  "Boys Golf", "Girls Golf",
  "Boys Volleyball", "Girls Volleyball",
  "Wrestling",
  "Cheer", "Dance",
  "Field Hockey", "Gymnastics", "Ice Hockey",
  "Water Polo", "Rugby", "Bowling",
  "Other",
] as const;

export const GENDERS = ["male", "female", "other"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = { male: "Male", female: "Female", other: "Other / prefer not to say" };

export const GRADES = [6, 7, 8, 9, 10, 11, 12] as const;

// The graduation year of a current 12th grader. Update yearly.
// 2027 => class currently in 12th grade will graduate in spring 2027.
export const CURRENT_SENIOR_GRAD_YEAR = 2027;

/** Given a grade (6-12), returns the expected spring graduation year. */
export function gradeToGradYear(grade: number | null | undefined): number | null {
  if (!grade || grade < 6 || grade > 12) return null;
  return CURRENT_SENIOR_GRAD_YEAR + (12 - grade);
}

/** Given a graduation year, returns the current grade (6-12) or null if out of range. */
export function gradYearToGrade(year: number | null | undefined): number | null {
  if (!year || !Number.isFinite(year)) return null;
  const g = 12 - (year - CURRENT_SENIOR_GRAD_YEAR);
  if (g < 6 || g > 12) return null;
  return g;
}

export const TEST_TYPES = [
  { value: "sprint_10y", label: "10-Yard Sprint", unit: "s", lowerIsBetter: true, group: "Speed" },
  { value: "sprint_40y", label: "40-Yard Sprint", unit: "s", lowerIsBetter: true, group: "Speed" },
  { value: "pro_agility", label: "Pro Agility (5-10-5)", unit: "s", lowerIsBetter: true, group: "Speed" },
  { value: "vertical_jump", label: "Vertical Jump", unit: "in", lowerIsBetter: false, group: "Jumps" },
  { value: "broad_jump", label: "Broad Jump", unit: "in", lowerIsBetter: false, group: "Jumps" },
  { value: "bench_1rm", label: "Bench Press 1RM", unit: "lb", lowerIsBetter: false, group: "Strength" },
  { value: "squat_1rm", label: "Back Squat 1RM", unit: "lb", lowerIsBetter: false, group: "Strength" },
  { value: "deadlift_1rm", label: "Deadlift 1RM", unit: "lb", lowerIsBetter: false, group: "Strength" },
  { value: "power_clean_1rm", label: "Power Clean 1RM", unit: "lb", lowerIsBetter: false, group: "Strength" },
] as const;

export type TestTypeValue = (typeof TEST_TYPES)[number]["value"];

export function testTypeMeta(v: string) {
  return TEST_TYPES.find((t) => t.value === v) ?? { value: v, label: v, unit: "", lowerIsBetter: false, group: "Other" };
}

// Known sprint distances in inches, keyed by test_type. Used to convert between
// seconds and mph so coaches can enter either.
const SPRINT_DISTANCE_IN: Record<string, number> = {
  sprint_10y: 360,   // 10 yd
  sprint_20y: 720,   // 20 yd
  sprint_40y: 1440,  // 40 yd
  sprint_60y: 2160,  // 60 yd
  sprint_100m: 3937.0079, // 100 m
  pro_agility: 720,  // 5-10-5 = 20 yd total
};

export function sprintDistanceIn(testType: string): number | null {
  return SPRINT_DISTANCE_IN[testType] ?? null;
}

/** seconds → mph over a distance (inches). */
export function secondsToMph(seconds: number, distanceIn: number): number {
  if (!seconds || seconds <= 0 || !distanceIn) return 0;
  const miles = distanceIn / 63360;
  const hours = seconds / 3600;
  return miles / hours;
}

/** mph → seconds over a distance (inches). */
export function mphToSeconds(mph: number, distanceIn: number): number {
  if (!mph || mph <= 0 || !distanceIn) return 0;
  const miles = distanceIn / 63360;
  return (miles / mph) * 3600;
}

// Bodyweight coefficient using Wilks-lite proxy: value / bodyweight ^ (2/3)
// Good relative-strength metric that scales fairly across weight classes.
export function bwCoefficient(value: number | null | undefined, bodyweight: number | null | undefined) {
  if (!value || !bodyweight || bodyweight <= 0) return null;
  return value / Math.pow(bodyweight, 2 / 3);
}

export function percentImprovement(first: number, latest: number, lowerIsBetter: boolean) {
  if (!first || first === 0) return 0;
  const delta = lowerIsBetter ? (first - latest) / first : (latest - first) / first;
  return delta * 100;
}

// Estimate an athlete's max for a target exercise from related exercises they HAVE logged.
// Given: front squat is 0.80 of back squat. If athlete has back squat 300 and no front squat,
// estimated front squat = 300 * 0.80 = 240.
// `rels` rows model: "from_exercise ≈ ratio × to_exercise" (ratio typically < 1 for the weaker lift).
// Returns the best (highest) estimate found across all related exercises, or null.
export type ExerciseRel = { from_exercise_id: string; to_exercise_id: string; ratio: number };
export function estimateMax(
  targetExerciseId: string,
  actualByExerciseId: Map<string, number>,
  rels: ExerciseRel[],
): { value: number; sourceExerciseId: string; ratio: number } | null {
  let best: { value: number; sourceExerciseId: string; ratio: number } | null = null;
  for (const r of rels) {
    let derived: number | null = null;
    let sourceId: string | null = null;
    // target = ratio * source  →  source known, compute target
    if (r.from_exercise_id === targetExerciseId) {
      const src = actualByExerciseId.get(r.to_exercise_id);
      if (src != null) { derived = src * r.ratio; sourceId = r.to_exercise_id; }
    }
    // source = target * (1/ratio)  →  if source known and target unknown, target = source / ratio
    if (r.to_exercise_id === targetExerciseId) {
      const src = actualByExerciseId.get(r.from_exercise_id);
      if (src != null && r.ratio > 0) { derived = src / r.ratio; sourceId = r.from_exercise_id; }
    }
    if (derived != null && sourceId && (!best || derived > best.value)) {
      best = { value: derived, sourceExerciseId: sourceId, ratio: r.ratio };
    }
  }
  return best;
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Array.from(rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set<string>()));
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

export function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  const csv = toCSV(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
