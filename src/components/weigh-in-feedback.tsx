// What an athlete sees right after logging a weight at a kiosk, before the next
// athlete steps up: what they just logged, where this week stands, and how it
// compares with their last counted week. Built from the same weekly math as the
// Team Grid and profile, from the athlete's own recent weigh-ins that the
// database hands back with the save.
import { useMemo } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  easternToday,
  formatChange,
  formatWeight,
  MIN_DAYS_FOR_WEEK,
  summarizeAthlete,
  trendOf,
  weekStartOf,
} from "@/lib/weigh-ins";
import { cn } from "@/lib/utils";

export type FeedbackLog = { log_date: string; value: number };

const TREND_TEXT = {
  up: "text-emerald-500",
  down: "text-red-500",
  flat: "text-muted-foreground",
} as const;

export function WeighInFeedback({
  name,
  value,
  logs,
}: {
  name: string;
  value: number;
  logs: FeedbackLog[];
}) {
  const info = useMemo(() => {
    const weighIns = logs.map((l) => ({
      athlete_id: "self",
      log_date: l.log_date,
      value: Number(l.value),
    }));
    const thisWeek = weekStartOf(easternToday());
    const summary = summarizeAthlete(weighIns, thisWeek);
    const current = summary.weeks.find((w) => w.weekStart === thisWeek) ?? null;
    const previous =
      [...summary.weeks].reverse().find((w) => w.counted && w.weekStart < thisWeek) ?? null;
    return { current, previous, first: logs.length <= 1 };
  }, [logs]);

  const { current, previous, first } = info;
  const days = current?.days ?? 0;
  const counted = current?.counted ?? false;
  const change =
    counted && current?.avg != null && previous?.avg != null ? current.avg - previous.avg : null;
  const trend = trendOf(change);
  const remaining = Math.max(0, MIN_DAYS_FOR_WEEK - days);

  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <CheckCircle2 className="h-10 w-10 text-primary" />
      <div className="text-lg font-semibold">Nice, {name}. You're checked in.</div>

      <div className="stat-number text-5xl tabular-nums">
        {formatWeight(value)}
        <span className="ml-1 text-base font-normal text-muted-foreground">lb</span>
      </div>

      {first ? (
        <p className="max-w-xs text-sm text-muted-foreground">
          That's your first weigh-in. Weigh in on {MIN_DAYS_FOR_WEEK} different days this week and
          your weekly average starts to count.
        </p>
      ) : counted ? (
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">
            This week's average:{" "}
            <b className="text-foreground tabular-nums">{formatWeight(current?.avg ?? null)} lb</b>
          </div>
          {change != null ? (
            <div className={cn("text-2xl font-bold tabular-nums", trend && TREND_TEXT[trend])}>
              {formatChange(change)} lb
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                vs your last counted week
              </span>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Your first counted week.</div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-1.5">
            {Array.from({ length: MIN_DAYS_FOR_WEEK }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-3 w-3 rounded-full border",
                  i < days ? "border-primary bg-primary" : "border-muted-foreground/40",
                )}
              />
            ))}
          </div>
          <div className="text-sm text-muted-foreground">
            {days} of {MIN_DAYS_FOR_WEEK} weigh-in days this week.{" "}
            {remaining > 0 && (
              <>
                {remaining} more {remaining === 1 ? "day" : "days"} and this week counts.
              </>
            )}
          </div>
          {previous?.avg != null && (
            <div className="text-xs text-muted-foreground">
              Last counted week averaged{" "}
              <b className="text-foreground tabular-nums">{formatWeight(previous.avg)} lb</b>.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
