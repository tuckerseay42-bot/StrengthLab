// The weekly weight math, in one place, with no database or screen code in it.
// Everything here works on Eastern calendar days as "YYYY-MM-DD" strings (the
// log_date the database stores), so there is no timezone arithmetic to get
// wrong. The Team Grid, the athlete profile and the check-in feedback all read
// from these functions, so they cannot disagree.
//
// The rules (Tucker's tracker request):
//  - A week runs Monday to Sunday.
//  - Each day counts once: several weigh-ins on a day are averaged to one number.
//  - A week's average is the average of its daily numbers.
//  - A week "counts" only with weigh-ins on 3 or more different days.
//  - Weekly change compares a counted week to the last counted week before it.
//  - Net change runs from the first counted week to the latest counted week.

export const MIN_DAYS_FOR_WEEK = 3;
export const APP_TIME_ZONE = "America/New_York";

export type WeighIn = { athlete_id: string; log_date: string; value: number };

export type WeekSummary = {
  weekStart: string;
  /** Different days that week with at least one weigh-in. */
  days: number;
  /** Average of the daily numbers; null when there were no weigh-ins. */
  avg: number | null;
  /** True when the week has weigh-ins on MIN_DAYS_FOR_WEEK or more different days. */
  counted: boolean;
  /** Change from the last counted week before this one. Only set on counted weeks. */
  change: number | null;
};

export type AthleteWeightSummary = {
  /** Every week from the first weigh-in through the requested end week, empty weeks included. */
  weeks: WeekSummary[];
  firstCounted: WeekSummary | null;
  latestCounted: WeekSummary | null;
  /** Latest counted average minus first counted average; null until two weeks have counted. */
  netChange: number | null;
};

const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: string, n: number): string {
  return fromUtcMs(toUtcMs(date) + n * DAY_MS);
}

/** The Monday of the week a date falls in (Sunday belongs to the week before it). */
export function weekStartOf(date: string): string {
  const dow = new Date(toUtcMs(date)).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  return addDays(date, -sinceMonday);
}

/** Today's date on the Eastern clock, the same day the database would file a weigh-in under. */
export function easternToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** One number per day: the average of that day's weigh-ins. */
export function dailyAverages(weighIns: WeighIn[]): Map<string, number> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const w of weighIns) {
    const cur = sums.get(w.log_date) ?? { total: 0, n: 0 };
    cur.total += Number(w.value);
    cur.n += 1;
    sums.set(w.log_date, cur);
  }
  const out = new Map<string, number>();
  for (const [date, { total, n }] of sums) out.set(date, total / n);
  return out;
}

/**
 * Week-by-week summary for one athlete's weigh-ins. Weeks run continuously from
 * the athlete's first weigh-in to `throughWeekStart` (default: the latest
 * weigh-in's week), so a missed week shows up as an empty week, not a gap.
 */
export function summarizeAthlete(
  weighIns: WeighIn[],
  throughWeekStart?: string,
): AthleteWeightSummary {
  const daily = dailyAverages(weighIns);
  if (daily.size === 0) {
    return { weeks: [], firstCounted: null, latestCounted: null, netChange: null };
  }

  const byWeek = new Map<string, number[]>();
  for (const [date, avg] of daily) {
    const ws = weekStartOf(date);
    const list = byWeek.get(ws) ?? [];
    list.push(avg);
    byWeek.set(ws, list);
  }

  const dates = [...daily.keys()].sort();
  const firstWeek = weekStartOf(dates[0]);
  const lastWeek = throughWeekStart ?? weekStartOf(dates[dates.length - 1]);

  const weeks: WeekSummary[] = [];
  let lastCounted: WeekSummary | null = null;
  let firstCounted: WeekSummary | null = null;
  for (let ws = firstWeek; ws <= lastWeek; ws = addDays(ws, 7)) {
    const list = byWeek.get(ws) ?? [];
    const avg = list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
    const counted = list.length >= MIN_DAYS_FOR_WEEK;
    const week: WeekSummary = {
      weekStart: ws,
      days: list.length,
      avg,
      counted,
      change:
        counted && lastCounted && lastCounted.avg != null && avg != null
          ? avg - lastCounted.avg
          : null,
    };
    if (counted) {
      if (!firstCounted) firstCounted = week;
      lastCounted = week;
    }
    weeks.push(week);
  }

  const latestCounted = lastCounted;
  const netChange =
    firstCounted && latestCounted && firstCounted !== latestCounted
      ? (latestCounted.avg as number) - (firstCounted.avg as number)
      : null;

  return { weeks, firstCounted, latestCounted, netChange };
}

/** The last `count` Monday dates ending with the week that contains `today`, oldest first. */
export function recentWeekStarts(today: string, count: number): string[] {
  const current = weekStartOf(today);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addDays(current, -7 * i));
  return out;
}

export type DateComparison = {
  from: number | null;
  to: number | null;
  /** to minus from; null unless both days have a weigh-in. */
  change: number | null;
};

/** Change between two calendar days, each using that day's average. */
export function changeBetweenDates(weighIns: WeighIn[], from: string, to: string): DateComparison {
  const daily = dailyAverages(weighIns);
  const a = daily.get(from) ?? null;
  const b = daily.get(to) ?? null;
  return { from: a, to: b, change: a != null && b != null ? b - a : null };
}

export type Trend = "up" | "down" | "flat";

/** up = green, down = red. A change that rounds to 0.0 lb is "flat" (gray). */
export function trendOf(change: number | null): Trend | null {
  if (change == null) return null;
  if (Math.abs(change) < 0.05) return "flat";
  return change > 0 ? "up" : "down";
}

export function formatWeight(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

export function formatChange(change: number | null): string {
  if (change == null) return "—";
  const rounded = Math.round(change * 10) / 10;
  if (rounded === 0) return "0.0";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1)}`;
}
