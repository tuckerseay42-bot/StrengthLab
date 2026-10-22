import { z } from "zod";
import { normalize, levenshtein, firstNameDistance, splitFullName } from "@/lib/name-match";

// Athlete input schema — used before insert/update.
// Sanity ranges use canonical units (lb, in).
export const athleteInputSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(80),
  last_name: z.string().trim().min(1, "Last name is required").max(80),
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
  wingspan: { min: 40, max: 100, label: "Wingspan (in)" },
};

export function validateTestValue(testType: string, value: number): string | null {
  const b = TEST_BOUNDS[testType];
  if (!b) return null;
  if (!Number.isFinite(value) || value <= 0) return `Enter a valid ${b.label}`;
  if (value < b.min) return `${b.label} of ${value} looks too low (expected ≥ ${b.min})`;
  if (value > b.max) return `${b.label} of ${value} looks too high (expected ≤ ${b.max})`;
  return null;
}

// A same-session jump this large (e.g. a 10-yard fly dropping from 1.0s to
// 0.3s on one entry) is essentially always a typo, not a real improvement —
// catches it for ANY test type, including org-defined custom ones that
// TEST_BOUNDS has no fixed min/max for, by comparing against the athlete's
// own prior best instead of a hardcoded range.
export const IMPLAUSIBLE_JUMP_PCT = 0.3;

/**
 * Flags a newly entered value as an implausible swing from the athlete's
 * current best for that test — only fires when there's a real prior best
 * to compare against (never blocks a first-ever entry) and the change
 * exceeds IMPLAUSIBLE_JUMP_PCT in either direction. Returns the percent
 * swing (positive = better, negative = worse) for the confirm prompt, or
 * null when nothing looks off.
 */
export function implausibleJump(
  newValue: number,
  priorBest: number | null,
  lowerIsBetter: boolean,
): number | null {
  if (priorBest == null || priorBest === 0 || !Number.isFinite(newValue)) return null;
  const rawPct = (newValue - priorBest) / priorBest;
  const improvementPct = lowerIsBetter ? -rawPct : rawPct;
  if (Math.abs(improvementPct) < IMPLAUSIBLE_JUMP_PCT) return null;
  return improvementPct;
}

// Duplicate athlete check — case/whitespace insensitive on full name.
export function findDuplicateAthlete<T extends { id: string; name: string }>(
  existing: T[], name: string, excludeId?: string,
): T | undefined {
  const norm = name.trim().toLowerCase().replace(/\s+/g, " ");
  return existing.find((a) => a.id !== excludeId && a.name.trim().toLowerCase().replace(/\s+/g, " ") === norm);
}

// ---- Duplicate athlete groups (roster-wide) ----
export type DuplicateReason = "name" | "student_id" | "email" | "fuzzy_name";
export type DuplicateGroup<T> = { key: string; reason: DuplicateReason; members: T[] };

type DupAthlete = {
  id: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  student_id?: string | null;
  athlete_email?: string | null;
};

/**
 * Groups athletes that look like the same person: identical normalized name
 * (suffix/punctuation-insensitive — "Abreham Evans Jr." and "Abreham Evans"
 * count as the same), identical student ID, identical email, or — a last
 * pass over whatever's left — a close-but-not-identical name (last name
 * within 1 edit, first name within 2 or a nickname-style prefix), which is
 * exactly the shape a repeated roster import produces when the same kid's
 * name gets typed or formatted slightly differently each time. Each
 * athlete appears in at most one group; a whole cluster that's mutually
 * close groups together in one pass, not just pairs, so an athlete
 * accidentally imported 3+ times gets offered as one group to merge, not
 * two separate 2-record groups.
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

  pass("name", (a) => normalize(a.name ?? "") || null);
  pass("student_id", (a) => (a.student_id ?? "").trim().toLowerCase() || null);
  pass("email", (a) => (a.athlete_email ?? "").trim().toLowerCase() || null);

  // Fuzzy pass: cluster whatever's left by close last+first name. Greedy —
  // each unclaimed athlete pulls in every other unclaimed athlete within
  // tolerance, so a mutually-close trio lands in one group.
  const names = new Map<string, { last: string; first: string }>();
  const nameOf = (a: T) => {
    let n = names.get(a.id);
    if (!n) {
      const split = splitFullName(a.name ?? "");
      n = {
        last: normalize(a.last_name || split.lastName),
        first: normalize(a.first_name || split.firstName),
      };
      names.set(a.id, n);
    }
    return n;
  };
  for (const a of athletes) {
    if (claimed.has(a.id)) continue;
    const an = nameOf(a);
    if (!an.last || !an.first) continue;
    const matches = athletes.filter((b) => {
      if (b.id === a.id || claimed.has(b.id)) return false;
      const bn = nameOf(b);
      if (!bn.last || !bn.first) return false;
      if (levenshtein(an.last, bn.last) > 1) return false;
      return firstNameDistance(an.first, bn.first) <= 2;
    });
    if (!matches.length) continue;
    const members = [a, ...matches];
    members.forEach((m) => claimed.add(m.id));
    groups.push({ key: `fuzzy_name:${an.last}:${an.first}`, reason: "fuzzy_name", members });
  }

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
