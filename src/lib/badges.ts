import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Athlete, TestRow, LiftRow, AttendanceRow, RepMax } from "@/lib/queries";

export type BadgeCriteria =
  | { type: "manual"; builtin_key?: string }
  | { type: "sessions_count"; threshold: number; builtin_key?: string }
  | { type: "attendance_pct"; threshold: number; builtin_key?: string }
  | { type: "test_threshold"; test_type: string; value: number; lower_is_better?: boolean; builtin_key?: string }
  | { type: "lift_threshold"; exercise: string; load: number; builtin_key?: string }
  | { type: "relative_strength_threshold"; exercise: string; ratio: number; builtin_key?: string }
  | { type: "pr_count"; count: number; builtin_key?: string };

export type Badge = {
  id: string;
  organization_id: string | null;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  criteria: BadgeCriteria;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AthleteBadge = {
  id: string;
  athlete_id: string;
  badge_id: string;
  awarded_at: string;
  awarded_by: string | null;
  evidence: Record<string, unknown> | null;
  created_at: string;
};

export const badgesQO = queryOptions({
  queryKey: ["badges"],
  queryFn: async (): Promise<Badge[]> => {
    const { data, error } = await supabase.from("badges").select("*").order("name");
    if (error) throw error;
    return (data ?? []) as unknown as Badge[];
  },
});

export const athleteBadgesQO = queryOptions({
  queryKey: ["athlete_badges"],
  queryFn: async (): Promise<AthleteBadge[]> => {
    const { data, error } = await supabase.from("athlete_badges").select("*").order("awarded_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as AthleteBadge[];
  },
});

export type BadgeProgress = {
  badge: Badge;
  earned: boolean;
  progress: number; // 0..1
  currentLabel?: string;
  targetLabel?: string;
  awardedAt?: string;
  evidence?: Record<string, unknown>;
};

function bestTest(tests: TestRow[], type: string, lowerIsBetter: boolean): number | null {
  const rows = tests.filter((t) => t.test_type === type);
  if (!rows.length) return null;
  return rows.reduce((acc, t) => (lowerIsBetter ? Math.min(acc, t.value) : Math.max(acc, t.value)), lowerIsBetter ? Infinity : -Infinity);
}

function bestLift(lifts: LiftRow[], repMaxes: RepMax[], exercise: string): number | null {
  const key = exercise.toLowerCase();
  let best = 0;
  for (const l of lifts) if (l.exercise.toLowerCase() === key && l.load != null) best = Math.max(best, l.load);
  for (const r of repMaxes) if (r.exercise_name.toLowerCase() === key && r.load != null) best = Math.max(best, r.load);
  return best > 0 ? best : null;
}

export function evaluateBadges(
  athlete: Athlete,
  tests: TestRow[],
  lifts: LiftRow[],
  attendance: AttendanceRow[],
  repMaxes: RepMax[],
  badges: Badge[],
  existing: AthleteBadge[],
): BadgeProgress[] {
  const earnedIds = new Set(existing.map((e) => e.badge_id));
  const sessionCount = attendance.filter((a) => a.present).length;
  const totalSessions = attendance.length;
  const attendancePct = totalSessions > 0 ? (sessionCount / totalSessions) * 100 : 0;
  const prCount = repMaxes.length;

  return badges.map((badge) => {
    const c = badge.criteria;
    const existingRow = existing.find((e) => e.badge_id === badge.id);
    const base: BadgeProgress = { badge, earned: earnedIds.has(badge.id), progress: earnedIds.has(badge.id) ? 1 : 0, awardedAt: existingRow?.awarded_at, evidence: existingRow?.evidence ?? undefined };
    if (base.earned) return base;

    switch (c.type) {
      case "manual":
        return { ...base, currentLabel: "Coach award", targetLabel: "Awarded by coach" };
      case "sessions_count": {
        const p = Math.min(1, sessionCount / c.threshold);
        return { ...base, progress: p, currentLabel: `${sessionCount} sessions`, targetLabel: `${c.threshold} sessions` };
      }
      case "attendance_pct": {
        const p = Math.min(1, attendancePct / c.threshold);
        return { ...base, progress: p, currentLabel: `${attendancePct.toFixed(0)}%`, targetLabel: `${c.threshold}%` };
      }
      case "pr_count": {
        const p = Math.min(1, prCount / c.count);
        return { ...base, progress: p, currentLabel: `${prCount} PRs`, targetLabel: `${c.count} PRs` };
      }
      case "test_threshold": {
        const lower = c.lower_is_better ?? false;
        const best = bestTest(tests, c.test_type, lower);
        if (best == null) return { ...base, currentLabel: "No data", targetLabel: `${c.value}` };
        const p = lower ? Math.min(1, c.value / best) : Math.min(1, best / c.value);
        return { ...base, progress: p, currentLabel: best.toFixed(2), targetLabel: c.value.toFixed(2) };
      }
      case "lift_threshold": {
        const best = bestLift(lifts, repMaxes, c.exercise);
        if (best == null) return { ...base, currentLabel: "No data", targetLabel: `${c.load} lb` };
        const p = Math.min(1, best / c.load);
        return { ...base, progress: p, currentLabel: `${best.toFixed(0)} lb`, targetLabel: `${c.load} lb` };
      }
      case "relative_strength_threshold": {
        const best = bestLift(lifts, repMaxes, c.exercise);
        const bw = athlete.bodyweight;
        if (!best || !bw) return { ...base, currentLabel: "No data", targetLabel: `${c.ratio.toFixed(2)}x BW` };
        const ratio = best / bw;
        const p = Math.min(1, ratio / c.ratio);
        return { ...base, progress: p, currentLabel: `${ratio.toFixed(2)}x`, targetLabel: `${c.ratio.toFixed(2)}x BW` };
      }
    }
    return base;
  });
}

export function meetsCriteria(bp: BadgeProgress): boolean {
  if (bp.badge.criteria.type === "manual") return false;
  return bp.progress >= 1;
}

export async function syncAthleteBadgeAwards(athleteId: string, progressList: BadgeProgress[]): Promise<number> {
  const toAward = progressList.filter((p) => !p.earned && meetsCriteria(p));
  if (!toAward.length) return 0;
  const { data: user } = await supabase.auth.getUser();
  const rows = toAward.map((p) => ({
    athlete_id: athleteId,
    badge_id: p.badge.id,
    awarded_by: user.user?.id ?? null,
    evidence: { current: p.currentLabel, target: p.targetLabel, auto: true },
  }));
  const { error } = await supabase.from("athlete_badges").insert(rows);
  if (error) throw error;
  return rows.length;
}
