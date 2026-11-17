import { normalize, splitFullName } from "@/lib/name-match";

/**
 * Bulk duplicate clean-up by FIRST name + LAST name.
 *
 * Two athletes are "the same kid" here when their first name and last name match
 * (case, punctuation and Jr/Sr ignored), using the first/last name fields and
 * falling back to splitting the old single "name" when those are empty. Two
 * records with the same name are NOT merged automatically when they clearly
 * are different people: both have a student ID and the IDs differ, or both have
 * a graduation year and the years differ. Those are reported for a hand review.
 */

export type DedupeAthlete = {
  id: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  student_id?: string | null;
  athlete_email?: string | null;
  graduation_year?: number | null;
  user_id?: string | null;
  created_at?: string | null;
};

export type History = { tests: number; lifts: number; attendance: number };

export function firstLastKey(a: DedupeAthlete): string | null {
  const split = splitFullName(a.name ?? "");
  const first = normalize(a.first_name || split.firstName);
  const last = normalize(a.last_name || split.lastName);
  // One-word names have nothing to compare on.
  if (!first || !last) return null;
  if (!a.first_name && !a.last_name && !(a.name ?? "").trim().includes(" ")) return null;
  return `${first}|${last}`;
}

const idOf = (a: DedupeAthlete) => (a.student_id ?? "").trim().toLowerCase();

/** True when these two records cannot be the same kid. */
export function conflicting(a: DedupeAthlete, b: DedupeAthlete): boolean {
  if (idOf(a) && idOf(b) && idOf(a) !== idOf(b)) return true;
  if (
    a.graduation_year != null &&
    b.graduation_year != null &&
    a.graduation_year !== b.graduation_year
  ) {
    return true;
  }
  return false;
}

const total = (h: History | undefined) => (h ? h.tests + h.lifts + h.attendance : 0);

/**
 * The record to keep: the one with the most history, then one linked to a login,
 * then one with a student ID, then one with an email, then the oldest.
 */
export function pickKeeper<T extends DedupeAthlete>(
  members: T[],
  history: Map<string, History>,
): T {
  const score = (a: T) => [
    total(history.get(a.id)),
    a.user_id ? 1 : 0,
    idOf(a) ? 1 : 0,
    (a.athlete_email ?? "").trim() ? 1 : 0,
  ];
  return [...members].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
    return (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id);
  })[0];
}

export type MergePlan<T> = { key: string; keep: T; drop: T[] };
export type ReviewGroup<T> = { key: string; members: T[] };

export function planFirstLastMerges<T extends DedupeAthlete>(
  athletes: T[],
  history: Map<string, History>,
): { merges: MergePlan<T>[]; needsReview: ReviewGroup<T>[] } {
  const buckets = new Map<string, T[]>();
  for (const a of athletes) {
    const k = firstLastKey(a);
    if (!k) continue;
    const list = buckets.get(k);
    if (list) list.push(a);
    else buckets.set(k, [a]);
  }

  const merges: MergePlan<T>[] = [];
  const needsReview: ReviewGroup<T>[] = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    // Split the same-name records into clusters whose members could all be one kid.
    const clusters: T[][] = [];
    for (const m of members) {
      const home = clusters.find((c) => c.every((o) => !conflicting(o, m)));
      if (home) home.push(m);
      else clusters.push([m]);
    }
    for (const c of clusters) {
      if (c.length < 2) continue;
      const keep = pickKeeper(c, history);
      merges.push({ key, keep, drop: c.filter((m) => m.id !== keep.id) });
    }
    if (clusters.length > 1) needsReview.push({ key, members });
  }
  merges.sort((a, b) => a.key.localeCompare(b.key));
  return { merges, needsReview };
}
