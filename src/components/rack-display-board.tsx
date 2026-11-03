// Read-only, TV/kiosk-friendly board — meant to be cast to a monitor in the
// weight room. A coach picks who to show (a team, a class period, or
// everyone assigned to a program) rather than the board depending on rack
// assignments existing; it falls back to those only to tag a "Rack N" label
// when they're on file, and strips out every editing control in favor of
// large, legible name cards that turn green the moment an athlete finishes
// logging today's actual prescribed workout.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  athletesQO,
  teamsQO,
  athleteTeamsQO,
  workoutsQO,
  workoutExercisesQO,
  workoutSetsQO,
  workoutAssignmentsQO,
  programsQO,
  programWorkoutsQO,
  athleteDisplayName,
  type Athlete,
} from "@/lib/queries";
import { rosterForTeam } from "@/lib/program-delivery";
import { resolveAthleteWorkout, buildPrescribedSets } from "@/lib/training-resolver";
import { useActiveTeamId } from "@/hooks/use-active-team";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/page-header";
import { CheckCircle2, Maximize2, Minimize2, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const today = () => new Date().toISOString().slice(0, 10);

type RackRow = { id: string; team_id: string; rack_number: number };
type RackMember = { rack_session_id: string; athlete_id: string; quadrant: number };

// Encodes which roster is showing as one Select value: "team:<id>",
// "period:<class_period>", or "program:<id>".
function parseSource(v: string): { kind: "team" | "period" | "program"; value: string } | null {
  const i = v.indexOf(":");
  if (i < 0) return null;
  const kind = v.slice(0, i);
  if (kind !== "team" && kind !== "period" && kind !== "program") return null;
  return { kind, value: v.slice(i + 1) };
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function RackDisplayBoard() {
  const qc = useQueryClient();
  const [activeTeamId] = useActiveTeamId();
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: athleteTeams = [] } = useQuery(athleteTeamsQO);
  const { data: workouts = [] } = useQuery(workoutsQO);
  const { data: workoutExercises = [] } = useQuery(workoutExercisesQO);
  const { data: workoutSets = [] } = useQuery(workoutSetsQO);
  const { data: workoutAssignments = [] } = useQuery(workoutAssignmentsQO);
  const { data: programs = [] } = useQuery(programsQO);
  const { data: programWorkouts = [] } = useQuery(programWorkoutsQO);
  const [source, setSource] = useState<string>(activeTeamId ? `team:${activeTeamId}` : "team:all");
  const [search, setSearch] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const now = useClock();

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  const athleteById = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const periods = useMemo(
    () =>
      Array.from(new Set(athletes.map((a) => a.class_period).filter((p): p is string => !!p))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [athletes],
  );
  const sortedPrograms = useMemo(
    () => programs.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [programs],
  );

  // Today's rack layout — used only to tag a "Rack N" label when a coach
  // has built Assign Racks for the day; the board's roster no longer
  // depends on it.
  const racksQ = useQuery({
    queryKey: ["rack-display-racks", today()],
    queryFn: async (): Promise<RackRow[]> => {
      const { data, error } = await supabase
        .from("rack_sessions")
        .select("id, team_id, rack_number")
        .eq("session_date", today())
        .order("rack_number");
      if (error) throw error;
      return (data ?? []) as unknown as RackRow[];
    },
    refetchInterval: 20_000,
  });
  const racks = racksQ.data ?? [];
  const rackIdsKey = racks.map((r) => r.id).join(",");

  const membersQ = useQuery({
    queryKey: ["rack-display-members", rackIdsKey],
    enabled: racks.length > 0,
    queryFn: async (): Promise<RackMember[]> => {
      const { data, error } = await supabase
        .from("rack_session_athletes")
        .select("rack_session_id, athlete_id, quadrant")
        .in(
          "rack_session_id",
          racks.map((r) => r.id),
        )
        .order("quadrant");
      if (error) throw error;
      return (data ?? []) as RackMember[];
    },
    refetchInterval: 20_000,
  });
  const members = membersQ.data ?? [];

  const rackNumberByAthlete = useMemo(() => {
    const rackById = new Map(racks.map((r) => [r.id, r]));
    const m = new Map<string, number>();
    for (const mem of members) {
      const rack = rackById.get(mem.rack_session_id);
      if (rack) m.set(mem.athlete_id, rack.rack_number);
    }
    return m;
  }, [racks, members]);

  // Today's logged sets — a rack_set_log always has a rack_session_id
  // (one gets auto-created the moment an athlete opens today's workout),
  // but that's independent of whether they were ever placed into a rack
  // via Assign Racks, so this is scoped by date, not by rack membership.
  const logsQ = useQuery({
    queryKey: ["rack-display-logs", today()],
    queryFn: async (): Promise<{ athlete_id: string; status: string }[]> => {
      const { data, error } = await supabase
        .from("rack_set_logs")
        .select("athlete_id, status")
        .gte("completed_at", `${today()}T00:00:00`)
        .lte("completed_at", `${today()}T23:59:59`);
      if (error) throw error;
      return (data ?? []) as { athlete_id: string; status: string }[];
    },
    refetchInterval: 20_000,
  });
  const logs = logsQ.data ?? [];

  // Live updates so the TV never needs a manual refresh.
  useEffect(() => {
    const ch = supabase
      .channel("rack-display-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "rack_sessions" }, () =>
        qc.invalidateQueries({ queryKey: ["rack-display-racks"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rack_session_athletes" },
        () => qc.invalidateQueries({ queryKey: ["rack-display-members"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "rack_set_logs" }, () =>
        qc.invalidateQueries({ queryKey: ["rack-display-logs"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [qc]);

  // Who's on the board — a coach-picked team, class period, or program,
  // not whatever happens to have a rack built for it today.
  const parsedSource = useMemo(() => parseSource(source), [source]);
  const roster = useMemo(() => {
    if (!parsedSource) return [];
    if (parsedSource.kind === "team") {
      if (parsedSource.value === "all") return athletes.slice();
      return rosterForTeam(athletes, athleteTeams, parsedSource.value);
    }
    if (parsedSource.kind === "period") {
      return athletes.filter((a) => a.class_period === parsedSource.value);
    }
    return athletes.filter((a) => a.program_id === parsedSource.value);
  }, [parsedSource, athletes, athleteTeams]);
  const sortedRoster = useMemo(
    () => roster.slice().sort((a, b) => athleteDisplayName(a).localeCompare(athleteDisplayName(b))),
    [roster],
  );

  // Whether each athlete on the board has logged every set of today's
  // actual prescribed workout (same resolver + set-expansion Live
  // Training's "Who's up" list uses) — this is what turns a name card
  // green.
  const finishedByAthlete = useMemo(() => {
    const logsByAthlete = new Map<string, { athlete_id: string; status: string }[]>();
    for (const l of logs) {
      const arr = logsByAthlete.get(l.athlete_id) ?? [];
      arr.push(l);
      logsByAthlete.set(l.athlete_id, arr);
    }
    const m = new Map<string, boolean>();
    for (const athlete of sortedRoster) {
      const resolved = resolveAthleteWorkout(athlete, today(), {
        assignments: workoutAssignments,
        programs,
        programWorkouts,
        athleteTeams,
      });
      const workout = resolved.workoutId
        ? (workouts.find((w) => w.id === resolved.workoutId) ?? null)
        : null;
      const prescribed = buildPrescribedSets(workout, workoutExercises, workoutSets);
      const totalSets = prescribed.length;
      const completedCount = (logsByAthlete.get(athlete.id) ?? []).filter(
        (l) => l.status === "completed",
      ).length;
      m.set(athlete.id, totalSets > 0 && completedCount >= totalSets);
    }
    return m;
  }, [
    logs,
    sortedRoster,
    workoutAssignments,
    programs,
    programWorkouts,
    athleteTeams,
    workouts,
    workoutExercises,
    workoutSets,
  ]);

  const needle = search.trim().toLowerCase();
  const matchesSearch = (a: Athlete) =>
    !needle || athleteDisplayName(a).toLowerCase().includes(needle);

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const timeLabel = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const sourceLabel =
    parsedSource?.kind === "period"
      ? parsedSource.value
      : parsedSource?.kind === "program"
        ? (sortedPrograms.find((p) => p.id === parsedSource.value)?.name ?? "Program")
        : parsedSource?.value === "all"
          ? "All athletes"
          : (teamById.get(parsedSource?.value ?? "")?.name ?? "Team");
  const finishedCount = sortedRoster.filter((a) => finishedByAthlete.get(a.id)).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-bold tracking-tight">{sourceLabel}</div>
          <div className="text-sm text-muted-foreground">
            {dateLabel} · {timeLabel}
            {sortedRoster.length > 0 && ` · ${finishedCount}/${sortedRoster.length} done`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find your name…"
              className="h-9 w-[180px] pl-8 text-sm"
            />
          </div>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="Pick who to show" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Teams</SelectLabel>
                <SelectItem value="team:all">All athletes</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={`team:${t.id}`}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectGroup>
              {periods.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Class periods</SelectLabel>
                    {periods.map((p) => (
                      <SelectItem key={p} value={`period:${p}`}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
              {sortedPrograms.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Programs</SelectLabel>
                    {sortedPrograms.map((p) => (
                      <SelectItem key={p.id} value={`program:${p.id}`}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={toggleFullscreen}>
            {fullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5 hidden sm:inline">{fullscreen ? "Exit" : "Fullscreen"}</span>
          </Button>
        </div>
      </div>

      {sortedRoster.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nobody on this board"
          description="Pick a team, class period, or program above that has athletes assigned to it."
        />
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto pb-4 pr-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {sortedRoster.map((a) => {
            const highlight = needle && matchesSearch(a);
            const finished = finishedByAthlete.get(a.id) ?? false;
            const dimmed = needle && !highlight;
            const rackNumber = rackNumberByAthlete.get(a.id);
            return (
              <div
                key={a.id}
                className={cn(
                  "flex flex-col gap-1 rounded-2xl border border-border/60 px-4 py-4 text-center shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-colors",
                  dimmed
                    ? "border-transparent bg-muted/20 text-muted-foreground/40"
                    : finished
                      ? "border-emerald-500/40 bg-emerald-500 text-white"
                      : highlight
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-card text-foreground",
                )}
              >
                {finished && !dimmed && <CheckCircle2 className="mx-auto h-6 w-6" />}
                <span className="truncate text-xl font-bold tracking-tight">
                  {athleteDisplayName(a)}
                </span>
                {rackNumber != null && (
                  <span
                    className={cn(
                      "text-xs font-medium uppercase tracking-wide",
                      finished || highlight ? "opacity-80" : "text-muted-foreground",
                    )}
                  >
                    Rack {rackNumber}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
