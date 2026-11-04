import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  athletesQO,
  athleteTeamsQO,
  athleteDisplayName,
  weighInsQO,
  type Athlete,
  type WeighInRow,
} from "@/lib/queries";
import {
  easternToday,
  formatChange,
  formatWeight,
  MIN_DAYS_FOR_WEEK,
  recentWeekStarts,
  summarizeAthlete,
  trendOf,
  weekStartOf,
  type AthleteWeightSummary,
  type Trend,
  type WeekSummary,
} from "@/lib/weigh-ins";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { Filters, emptyFilters, filterAthletes, type FilterState } from "@/components/filters";
import { PageHeader, EmptyState, ErrorState } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/weight")({
  head: () => ({
    meta: [
      { title: "Weight — Strength Lab" },
      {
        name: "description",
        content:
          "Weekly average body weight for every athlete, with the weekly change in green or red.",
      },
    ],
  }),
  component: WeightPage,
});

type SortKey = "name" | "drop" | "gain" | "stale";

const TREND_CLASS: Record<Trend, string> = {
  up: "text-emerald-500",
  down: "text-red-500",
  flat: "text-muted-foreground",
};

function shortDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function daysBetween(from: string, to: string) {
  return Math.round(
    (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000,
  );
}

function WeekCell({ week }: { week: WeekSummary | undefined }) {
  if (!week || week.days === 0 || week.avg == null) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  if (!week.counted) {
    return (
      <div className="leading-tight opacity-45">
        <div className="tabular-nums">{formatWeight(week.avg)}</div>
        <div className="text-[10px]">
          {week.days} of {MIN_DAYS_FOR_WEEK}
        </div>
      </div>
    );
  }
  const trend = trendOf(week.change);
  return (
    <div className="leading-tight">
      <div className="font-bold tabular-nums">{formatWeight(week.avg)}</div>
      <div className={cn("text-[10px] font-semibold tabular-nums", trend && TREND_CLASS[trend])}>
        {week.change == null ? "" : formatChange(week.change)}
      </div>
    </div>
  );
}

function WeightPage() {
  const qc = useQueryClient();
  const [activeTeamId] = useActiveTeamId();
  const { data: athletes = [], isLoading: athletesLoading } = useQuery(athletesQO);
  const { data: athleteTeams = [] } = useQuery(athleteTeamsQO);
  const weighInsQ = useQuery(weighInsQO);
  const weighIns = weighInsQ.data;

  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [search, setSearch] = useState("");
  const [weeksShown, setWeeksShown] = useState("8");
  const [sort, setSort] = useState<SortKey>("name");

  // A coach logging a weigh-in elsewhere (or an athlete at the kiosk) shows up
  // here without a refresh.
  useEffect(() => {
    const ch = supabase
      .channel("weight-grid")
      .on("postgres_changes", { event: "*", schema: "public", table: "weigh_ins" }, () =>
        qc.invalidateQueries({ queryKey: ["weigh_ins"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [qc]);

  const today = easternToday();
  const thisWeek = weekStartOf(today);
  const weekStarts = useMemo(
    () => recentWeekStarts(today, Number(weeksShown)),
    [today, weeksShown],
  );

  const roster = useMemo(() => {
    const byAthlete = new Map<string, Set<string>>();
    for (const at of athleteTeams) {
      const s = byAthlete.get(at.athlete_id) ?? new Set<string>();
      s.add(at.team_id);
      byAthlete.set(at.athlete_id, s);
    }
    const base = filterAthletes(athletes, filters, activeTeamId, byAthlete);
    const q = search.trim().toLowerCase();
    return q ? base.filter((a) => athleteDisplayName(a).toLowerCase().includes(q)) : base;
  }, [athletes, athleteTeams, filters, activeTeamId, search]);

  const rows = useMemo(() => {
    const byAthlete = new Map<string, WeighInRow[]>();
    for (const w of weighIns ?? []) {
      const list = byAthlete.get(w.athlete_id) ?? [];
      list.push(w);
      byAthlete.set(w.athlete_id, list);
    }
    return roster.map((athlete) => {
      const list = byAthlete.get(athlete.id) ?? [];
      const summary: AthleteWeightSummary = summarizeAthlete(list, thisWeek);
      const lastDate = list.reduce<string | null>(
        (best, w) => (best == null || w.log_date > best ? w.log_date : best),
        null,
      );
      const byWeek = new Map(summary.weeks.map((wk) => [wk.weekStart, wk]));
      return { athlete, summary, byWeek, lastDate };
    });
  }, [roster, weighIns, thisWeek]);

  const sorted = useMemo(() => {
    const list = rows.slice();
    const byName = (a: Athlete, b: Athlete) =>
      athleteDisplayName(a).localeCompare(athleteDisplayName(b));
    if (sort === "name") list.sort((a, b) => byName(a.athlete, b.athlete));
    else if (sort === "drop" || sort === "gain") {
      const dir = sort === "drop" ? 1 : -1;
      list.sort((a, b) => {
        const av = a.summary.netChange;
        const bv = b.summary.netChange;
        if (av == null && bv == null) return byName(a.athlete, b.athlete);
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * dir || byName(a.athlete, b.athlete);
      });
    } else {
      list.sort((a, b) => {
        if (a.lastDate == null && b.lastDate == null) return byName(a.athlete, b.athlete);
        if (a.lastDate == null) return -1;
        if (b.lastDate == null) return 1;
        return a.lastDate.localeCompare(b.lastDate) || byName(a.athlete, b.athlete);
      });
    }
    return list;
  }, [rows, sort]);

  const weighedThisWeek = rows.filter((r) => (r.byWeek.get(thisWeek)?.days ?? 0) > 0).length;
  const quiet = rows.filter(
    (r) => r.lastDate == null || daysBetween(r.lastDate, today) >= 7,
  ).length;

  const loading = athletesLoading || weighInsQ.isLoading;

  return (
    <div>
      <PageHeader
        eyebrow="Tracking"
        title="Weight"
        description="Weekly average body weight for every athlete. Each day counts once, and a week counts only with weigh-ins on 3 or more different days."
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Filters value={filters} onChange={setFilters} athletes={athletes} showDates={false} />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search athlete…"
          className="h-8 w-40 text-xs"
        />
        <Select value={weeksShown} onValueChange={setWeeksShown}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="6">Last 6 weeks</SelectItem>
            <SelectItem value="8">Last 8 weeks</SelectItem>
            <SelectItem value="12">Last 12 weeks</SelectItem>
            <SelectItem value="16">Last 16 weeks</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Sort: name</SelectItem>
            <SelectItem value="drop">Sort: biggest drop</SelectItem>
            <SelectItem value="gain">Sort: biggest gain</SelectItem>
            <SelectItem value="stale">Sort: longest since weighed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {weighInsQ.isError ? (
        <ErrorState
          title="Weight history isn't available yet"
          description="The weigh-in history table isn't there yet. It arrives with the latest database update, so try again after the sync finishes."
          onRetry={() => void weighInsQ.refetch()}
        />
      ) : loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !roster.length ? (
        <EmptyState
          icon={Scale}
          title="No athletes match these filters"
          description="Change the filters or the team at the top to see more athletes."
        />
      ) : !(weighIns ?? []).length ? (
        <EmptyState
          icon={Scale}
          title="No weigh-ins yet"
          description="Athletes log their weight at check-in, and coaches can add one from an athlete's profile. They show up here as soon as they're saved."
        />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {rows.length} athletes · {weighedThisWeek} weighed this week
            </span>
            <span>{quiet} not weighed in 7+ days</span>
            <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                <b className="text-foreground">185.4</b> counts (3+ days)
              </span>
              <span className="opacity-60">
                185.4 <span className="text-[10px]">2 of 3</span> doesn't count yet
              </span>
              <span>— no weigh-ins</span>
              <span className="text-emerald-500">+ up</span>
              <span className="text-red-500">− down</span>
            </span>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Athlete
                      </th>
                      {weekStarts.map((ws) => (
                        <th
                          key={ws}
                          className={cn(
                            "px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                            ws === thisWeek && "text-foreground",
                          )}
                        >
                          {shortDate(ws)}
                          {ws === thisWeek && (
                            <div className="text-[9px] font-normal normal-case tracking-normal">
                              this week
                            </div>
                          )}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Net change
                      </th>
                      <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Last weighed
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(({ athlete, summary, byWeek, lastDate }) => {
                      const net = trendOf(summary.netChange);
                      const since = lastDate ? daysBetween(lastDate, today) : null;
                      return (
                        <tr
                          key={athlete.id}
                          className="border-t border-border/50 hover:bg-muted/20"
                        >
                          <td className="sticky left-0 z-10 bg-background px-3 py-1.5">
                            <Link
                              to="/athletes/$id"
                              params={{ id: athlete.id }}
                              className="font-medium hover:text-primary"
                            >
                              {athleteDisplayName(athlete)}
                            </Link>
                            <div className="text-[10px] text-muted-foreground">
                              {[
                                athlete.grade ? `G${athlete.grade}` : null,
                                athlete.position,
                                athlete.sport,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </td>
                          {weekStarts.map((ws) => (
                            <td key={ws} className="px-2 py-1.5 text-center">
                              <WeekCell week={byWeek.get(ws)} />
                            </td>
                          ))}
                          <td className="px-3 py-1.5 text-right">
                            {summary.netChange == null ? (
                              <span className="text-muted-foreground/50">—</span>
                            ) : (
                              <span
                                className={cn("font-bold tabular-nums", net && TREND_CLASS[net])}
                              >
                                {formatChange(summary.netChange)}
                                <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">
                                  lb
                                </span>
                              </span>
                            )}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground",
                              (since == null || since >= 7) && "text-amber-500",
                            )}
                          >
                            {lastDate ? shortDate(lastDate) : "never"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Weeks run Monday to Sunday (Eastern time). Weekly change compares a counted week to the
            last counted week before it. Net change runs from an athlete's first counted week to
            their latest.
          </p>
        </>
      )}
    </div>
  );
}
