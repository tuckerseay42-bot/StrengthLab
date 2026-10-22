// Matches a roster import row (a student's LEGAL name, as Infinite Campus or
// a similar school SIS records it) against existing athletes, who are often
// entered under a nickname/preferred name instead. Exact matches are rare —
// this scores every athlete and lets the caller present the best guess for
// a coach to confirm rather than silently applying a wrong match.
import type { Athlete } from "@/lib/queries";

export type NameMatchInput = {
  firstName: string;
  lastName: string;
  studentId?: string | null;
};

export type MatchConfidence = "id" | "exact" | "fuzzy" | "weak";

export type MatchCandidate = {
  athlete: Athlete;
  confidence: MatchConfidence;
};

// A review-table row's confidence also covers the two states a raw match
// score can't produce on its own: a coach picked the match by hand, or
// nothing matched at all. Shared by every import flow (roster CSV/PDF,
// test-sheet photo/voice) that shows this same "review before applying"
// table.
export type RowMatchConfidence = MatchConfidence | "manual" | "none";

export const MATCH_CONFIDENCE_LABEL: Record<RowMatchConfidence, string> = {
  id: "Matched by student ID",
  exact: "Exact name match",
  fuzzy: "Likely match — review",
  weak: "Last-name match only — please review",
  manual: "Confirmed",
  none: "No match found",
};

export const MATCH_CONFIDENCE_CLASS: Record<RowMatchConfidence, string> = {
  id: "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/15 text-[color:var(--color-success)]",
  exact:
    "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/15 text-[color:var(--color-success)]",
  manual:
    "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/15 text-[color:var(--color-success)]",
  fuzzy: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  weak: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  none: "border-border bg-muted text-muted-foreground",
};

// Review order: rows needing a closer look float to the top instead of
// making the coach hunt for them in a long list.
export const MATCH_CONFIDENCE_REVIEW_ORDER: Record<RowMatchConfidence, number> = {
  none: 0,
  weak: 1,
  fuzzy: 2,
  manual: 3,
  exact: 4,
  id: 5,
};

const SUFFIX_RE = /\b(jr|sr|ii|iii|iv|v)\b\.?/g;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(SUFFIX_RE, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Classic edit-distance — small inputs only (first/last name strings). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prevDiag = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prevDiag + cost);
      prevDiag = temp;
    }
  }
  return dp[n];
}

/** How close two first names are, treating a nickname-style prefix as a near-match. */
function firstNameDistance(a: string, b: string): number {
  if (!a || !b) return 99;
  if (a === b) return 0;
  if (a.startsWith(b) || b.startsWith(a)) return 1;
  return levenshtein(a, b);
}

/**
 * Scores every athlete against one import row and returns the best
 * candidates, best first. `studentId` match always wins outright. Otherwise
 * last name must be an exact or near-exact (distance <= 1) match before a
 * first-name difference is tolerated at all — two unrelated families rarely
 * share a last name, but siblings/cousins often do, so last name alone is
 * never enough to call a match "exact".
 */
export function matchCandidates(row: NameMatchInput, athletes: Athlete[]): MatchCandidate[] {
  const rowLast = normalize(row.lastName);
  const rowFirst = normalize(row.firstName);
  const studentId = row.studentId?.trim();

  const idHit = studentId
    ? athletes.find((a) => a.student_id && a.student_id.trim() === studentId)
    : undefined;
  if (idHit) return [{ athlete: idHit, confidence: "id" }];

  const scored: { athlete: Athlete; lastDist: number; firstDist: number }[] = [];
  for (const a of athletes) {
    const aLast = normalize(a.last_name || a.name.split(/\s+/).slice(-1)[0] || "");
    if (!aLast) continue;
    const lastDist = levenshtein(rowLast, aLast);
    if (lastDist > 2) continue;
    const firstCandidates = [a.first_name, a.preferred_name, a.name.split(/\s+/)[0]]
      .filter((s): s is string => !!s)
      .map(normalize);
    const firstDist = firstCandidates.length
      ? Math.min(...firstCandidates.map((f) => firstNameDistance(rowFirst, f)))
      : 99;
    scored.push({ athlete: a, lastDist, firstDist });
  }

  scored.sort((x, y) => x.lastDist * 3 + x.firstDist - (y.lastDist * 3 + y.firstDist));

  return scored.slice(0, 5).map(({ athlete, lastDist, firstDist }) => ({
    athlete,
    confidence:
      lastDist === 0 && firstDist === 0
        ? "exact"
        : lastDist <= 1 && firstDist <= 2
          ? "fuzzy"
          : "weak",
  }));
}
