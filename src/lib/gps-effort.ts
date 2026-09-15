// Combined effort (acceleration + deceleration counts) vs. the athlete's own
// historical average for that weekday — the "Loaf" comparison.
import type { GpsReportRow } from "./gps-report";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function weekdayOf(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return WEEKDAYS[d.getDay()] ?? "";
}

/** Accel + decel for one session. Null when neither count is present. */
export function combinedEffort(r: GpsReportRow): number | null {
  const a = r.acceleration_count ?? null;
  const d = r.deceleration_count ?? null;
  if (a == null && d == null) return null;
  return (a ?? 0) + (d ?? 0);
}

export type EffortVerdict = {
  /** Combined effort total for the session. */
  total: number | null;
  weekday: string;
  /** Average combined effort on prior sessions that fell on the same weekday. */
  weekdayAvg: number | null;
  /** Prior same-weekday sessions used for the average. */
  sampleSize: number;
  kind: "loaf" | "harder" | "no-history" | "none";
  /** Whole-number difference: shortfall (loaf) or surplus (harder). */
  diff: number | null;
  message: string;
};

/**
 * Compares one session against the athlete's other valid prior sessions on the
 * same weekday. `history` should be that athlete's full set of valid rows.
 */
export function effortVerdict(row: GpsReportRow, history: GpsReportRow[]): EffortVerdict {
  const weekday = weekdayOf(row.session_date);
  const total = combinedEffort(row);
  if (total == null) {
    return { total: null, weekday, weekdayAvg: null, sampleSize: 0, kind: "none", diff: null, message: "No accel/decel data for this session." };
  }

  const priors = history.filter(
    (r) =>
      r !== row &&
      r.session_date < row.session_date &&
      weekdayOf(r.session_date) === weekday &&
      combinedEffort(r) != null,
  );

  if (!priors.length) {
    return {
      total,
      weekday,
      weekdayAvg: null,
      sampleSize: 0,
      kind: "no-history",
      diff: null,
      message: `Not enough history yet for ${weekday} comparison.`,
    };
  }

  const avg = priors.reduce((s, r) => s + (combinedEffort(r) ?? 0), 0) / priors.length;

  if (total < avg) {
    const shortfall = Math.round(avg - total);
    return {
      total,
      weekday,
      weekdayAvg: avg,
      sampleSize: priors.length,
      kind: "loaf",
      diff: shortfall,
      message: `${shortfall} Loafs during practice.`,
    };
  }

  const surplus = Math.round(total - avg);
  return {
    total,
    weekday,
    weekdayAvg: avg,
    sampleSize: priors.length,
    kind: "harder",
    diff: surplus,
    message: `Practiced harder than average (+${surplus}).`,
  };
}

/** Verdict for an athlete's most recent session. */
export function latestEffortVerdict(rows: GpsReportRow[]): EffortVerdict | null {
  const sorted = [...rows].sort((a, b) => a.session_date.localeCompare(b.session_date));
  const last = sorted[sorted.length - 1];
  if (!last) return null;
  return effortVerdict(last, sorted);
}
