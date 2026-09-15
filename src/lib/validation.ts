import { z } from "zod";

// Athlete input schema — used before insert/update.
// Sanity ranges use canonical units (lb, in).
export const athleteInputSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(80),
  last_name: z.string().trim().min(1, "Last name is required").max(80),
  preferred_name: z.string().trim().max(80).optional().or(z.literal("")),
  grade: z.number().int().min(1).max(12).nullable().optional(),
  bodyweight: z.number().positive().min(40, "Bodyweight looks too low").max(700, "Bodyweight looks too high").nullable().optional(),
  height_in: z.number().positive().min(36, "Height looks too low").max(96, "Height looks too high").nullable().optional(),
  athlete_email: z.string().trim().email("Invalid email").max(255).nullable().optional().or(z.literal("")),
  parent_email: z.string().trim().email("Invalid email").max(255).nullable().optional().or(z.literal("")),
});

// Test result validation. Sanity bounds per test type.
const TEST_BOUNDS: Record<string, { min: number; max: number; label: string }> = {
  sprint_10y: { min: 1.0, max: 4.0, label: "10y sprint" },
  sprint_40y: { min: 3.5, max: 10.0, label: "40y sprint" },
  pro_agility: { min: 3.5, max: 10.0, label: "Pro agility" },
  vertical_jump: { min: 5, max: 60, label: "Vertical jump (in)" },
  broad_jump: { min: 40, max: 160, label: "Broad jump (in)" },
  bench_1rm: { min: 20, max: 800, label: "Bench 1RM (lb)" },
  squat_1rm: { min: 20, max: 1200, label: "Squat 1RM (lb)" },
  deadlift_1rm: { min: 20, max: 1200, label: "Deadlift 1RM (lb)" },
  power_clean_1rm: { min: 20, max: 700, label: "Power clean 1RM (lb)" },
};

export function validateTestValue(testType: string, value: number): string | null {
  const b = TEST_BOUNDS[testType];
  if (!b) return null;
  if (!Number.isFinite(value) || value <= 0) return `Enter a valid ${b.label}`;
  if (value < b.min) return `${b.label} of ${value} looks too low (expected ≥ ${b.min})`;
  if (value > b.max) return `${b.label} of ${value} looks too high (expected ≤ ${b.max})`;
  return null;
}

// Duplicate athlete check — case/whitespace insensitive on full name.
export function findDuplicateAthlete<T extends { id: string; name: string }>(
  existing: T[], name: string, excludeId?: string,
): T | undefined {
  const norm = name.trim().toLowerCase().replace(/\s+/g, " ");
  return existing.find((a) => a.id !== excludeId && a.name.trim().toLowerCase().replace(/\s+/g, " ") === norm);
}

// ---- Duplicate athlete groups (roster-wide) ----
export type DuplicateReason = "name" | "student_id" | "email";
export type DuplicateGroup<T> = { key: string; reason: DuplicateReason; members: T[] };

type DupAthlete = {
  id: string;
  name: string;
  student_id?: string | null;
  athlete_email?: string | null;
};

const normName = (s: string) =>
  s.toLowerCase().replace(/[.'`’-]/g, "").replace(/\s+/g, " ").trim();

/**
 * Groups athletes that look like the same person: identical normalized name,
 * identical student ID, or identical email. Each athlete appears in at most
 * one group (name matches win, then student ID, then email).
 */
export function findAthleteDuplicateGroups<T extends DupAthlete>(athletes: T[]): DuplicateGroup<T>[] {
  const groups: DuplicateGroup<T>[] = [];
  const claimed = new Set<string>();

  const pass = (reason: DuplicateReason, keyOf: (a: T) => string | null) => {
    const buckets = new Map<string, T[]>();
    for (const a of athletes) {
      if (claimed.has(a.id)) continue;
      const k = keyOf(a);
      if (!k) continue;
      const list = buckets.get(k);
      if (list) list.push(a); else buckets.set(k, [a]);
    }
    for (const [k, members] of buckets) {
      if (members.length < 2) continue;
      members.forEach((m) => claimed.add(m.id));
      groups.push({ key: `${reason}:${k}`, reason, members });
    }
  };

  pass("name", (a) => normName(a.name ?? "") || null);
  pass("student_id", (a) => (a.student_id ?? "").trim().toLowerCase() || null);
  pass("email", (a) => (a.athlete_email ?? "").trim().toLowerCase() || null);

  return groups;
}


// Duplicate metric name check.
export function findDuplicateMetric<T extends { id: string; name: string }>(
  existing: T[], name: string, excludeId?: string,
): T | undefined {
  const norm = name.trim().toLowerCase();
  return existing.find((m) => m.id !== excludeId && m.name.trim().toLowerCase() === norm);
}

// Duplicate test session — same athlete, same test_type, same date.
export function findDuplicateTest<T extends { id: string; athlete_id: string; test_type: string; test_date: string }>(
  existing: T[], row: { athlete_id: string; test_type: string; test_date: string }, excludeId?: string,
): T | undefined {
  return existing.find((t) => t.id !== excludeId
    && t.athlete_id === row.athlete_id
    && t.test_type === row.test_type
    && t.test_date === row.test_date);
}

export type ValidationResult = { ok: true } | { ok: false; message: string };
