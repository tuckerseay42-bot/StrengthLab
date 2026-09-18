import { createFileRoute, Link } from "@tanstack/react-router";
import { estimate1RM } from "@/lib/one-rm";
import { getOrg1RMFormula } from "@/hooks/use-1rm-formula";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  athletesQO, liftsQO, liftSetsQO, teamsQO, testsQO, testTypesQO, exercisesQO, athleteDisplayName,
  workoutsQO, workoutAssignmentsQO, workoutBlocksQO, workoutExercisesQO, workoutSetsQO, repMaxesQO,
  type Athlete, type LiftRow, type LiftSet, type Team, type TestRow,
  type WorkoutExercise, type WorkoutSet, type Exercise,
} from "@/lib/queries";

import { testTypeMeta as baseTestTypeMeta, SPORTS, GENDERS, GENDER_LABELS } from "@/lib/domain";
import { suggestLoad } from "@/lib/prescription";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Crown, RefreshCw, Trophy, ChevronLeft, ChevronRight, Dumbbell,
  Activity, Flame, AlertTriangle, Users, CheckCircle2, Zap, Clock, Filter, Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/live-leaderboard")({
  head: () => ({ meta: [{ title: "Command Center — Strength Lab" }] }),
  component: LiveLeaderboardPage,
});

type LiftMetric = "e1rm" | "weight" | "reps" | "velocity" | "time" | "mph" | "distance";
type RangeKind = "today" | "week" | "month" | "year" | "all" | "custom";

const LIFT_METRIC_LABELS: Record<LiftMetric, string> = {
  e1rm: "Est. 1RM", weight: "Best Weight", reps: "Best Reps", velocity: "Best Velocity",
  time: "Best Time", mph: "Top Speed", distance: "Best Distance",
};
const RANGE_LABELS: Record<RangeKind, string> = {
  today: "Today", week: "This Week", month: "This Month", year: "This Year", all: "All-Time", custom: "Custom",
};

type MetricOption =
  | { kind: "lift"; id: string; label: string; group: string; exercise: string; metric: LiftMetric; unit: string; lowerIsBetter: boolean }
  | { kind: "test"; id: string; label: string; group: string; testType: string; unit: string; lowerIsBetter: boolean };


type Entry = { athlete_id: string; value: number; date: string; createdAt: number };
type DateBounds = { start: string | null; end: string | null };

const JUST_LOGGED_MS = 30_000;

function epley(load: number, reps: number) { return estimate1RM(load, reps, getOrg1RMFormula()) ?? load; }

/**
 * Fly/sprint zone distance implied by the exercise name, in inches.
 * "30/10 Fly" and "Flying 30-10yd" are both a 10 yard timed zone.
 */
function impliedZoneInches(name: string): number | null {
  const n = name.toLowerCase();
  const yd = n.match(/(\d+(?:\.\d+)?)\s*(?:yd|yard)/);
  if (yd?.[1]) return Number(yd[1]) * 36;
  const m = n.match(/(\d+(?:\.\d+)?)\s*m\b/);
  if (m?.[1]) return Number(m[1]) * 39.3701;
  const pair = n.match(/(\d+(?:\.\d+)?)\s*[/-]\s*(\d+(?:\.\d+)?)/);
  if (pair?.[2]) return Number(pair[2]) * 36;
  return null;
}


function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function timestampDateKey(ts: number) {
  return Number.isFinite(ts) ? localDateKey(new Date(ts)) : null;
}
function formatDateOnly(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "numeric" });
}
function rangeBounds(kind: RangeKind, from: string, to: string): DateBounds {
  const now = new Date();
  if (kind === "all") return { start: null, end: null };
  if (kind === "today") { const t = localDateKey(now); return { start: t, end: t }; }
  if (kind === "year") return { start: localDateKey(new Date(now.getFullYear(), 0, 1)), end: null };
  if (kind === "month") return { start: localDateKey(new Date(now.getFullYear(), now.getMonth(), 1)), end: null };
  if (kind === "week") { const d = new Date(now); d.setDate(d.getDate() - 7); return { start: localDateKey(d), end: null }; }
  return { start: from || null, end: to || null };
}
function dateInBounds(date: string, { start, end }: DateBounds) {
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}
function fmtValue(v: number, unit: string): string {
  if (unit === "m/s") return `${v.toFixed(2)} m/s`;
  if (unit === "lb") return `${Math.round(v / 5) * 5} lb`;
  if (unit === "s") return `${v.toFixed(2)} s`;
  if (unit === "in") return `${v.toFixed(2)} in`;
  if (unit === "reps") return `${Math.round(v)} reps`;
  return `${v.toFixed(2)}${unit ? ` ${unit}` : ""}`;
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase() || "?";
}
function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
function useNow(interval = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(id);
  }, [interval]);
  return now;
}

function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback((next: T) => {
    setV(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, [key]);
  return [v, set];
}

const fmtDate = formatDateOnly;

// ---------------------------------------------------------------------------
// Rack + activity queries — today only, refetch on interval, realtime top-up.
// ---------------------------------------------------------------------------

type RackSessionRow = {
  id: string; rack_number: number; team_id: string; workout_id: string | null;
  status: string; session_date: string; active_athlete_id: string | null;
  athlete_ids: string[]; organization_id: string; updated_at: string;
};
type RackSetLogRow = {
  id: string; rack_session_id: string; athlete_id: string; workout_exercise_id: string;
  set_position: number; load: number | null; reps: number | null;
  avg_velocity: number | null; peak_velocity: number | null; estimated_1rm: number | null;
  prescribed_load: number | null; prescribed_reps: number | null;
  status: string; approval_status: string; validation_status: string;
  override_status: string; review_reason: string | null;
  completed_at: string; created_at: string;
};

function useTodayRackSessions(enabled: boolean) {
  return useQuery({
    queryKey: ["cc_rack_sessions", localDateKey()],
    enabled,
    refetchInterval: enabled ? 20_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rack_sessions")
        .select("*")
        .eq("session_date", localDateKey())
        .order("rack_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RackSessionRow[];
    },
  });
}
function useTodayRackSetLogs(enabled: boolean) {
  return useQuery({
    queryKey: ["cc_rack_set_logs", localDateKey()],
    enabled,
    refetchInterval: enabled ? 20_000 : false,
    queryFn: async () => {
      const since = new Date(); since.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("rack_set_logs")
        .select("*")
        .gte("completed_at", since.toISOString())
        .order("completed_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as RackSetLogRow[];
    },
  });
}

type RackSessionAthleteRow = {
  id: string; rack_session_id: string; athlete_id: string;
  opened_at: string | null; last_seen_at: string | null;
};
function useTodayRackSessionAthletes(enabled: boolean) {
  return useQuery({
    queryKey: ["cc_rack_session_athletes", localDateKey()],
    enabled,
    refetchInterval: enabled ? 20_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rack_session_athletes")
        .select("id, rack_session_id, athlete_id, opened_at, last_seen_at, rack_sessions!inner(session_date)")
        .eq("rack_sessions.session_date", localDateKey());
      if (error) throw error;
      return (data ?? []) as unknown as RackSessionAthleteRow[];
    },
  });
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type CommandCenterTab = "live" | "leaderboard" | "workout";

function LiveLeaderboardPage() {
  const qc = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [activeTab, setActiveTab] = useState<CommandCenterTab>("live");
  const now = useNow(5000);

  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: teams = [] } = useQuery(teamsQO);
  // Rack floor + KPI strip are visible on every tab, so they always poll.
  // Lifts/tests only feed the Leaderboard tab's boards — no reason to pull
  // that data on a 20s cadence while a coach is on Live Now or Today's
  // Workout instead.
  const refetchInterval = autoRefresh && activeTab === "leaderboard" ? 20_000 : false;
  const { data: lifts = [] } = useQuery({ ...liftsQO, refetchInterval });
  const { data: liftSets = [] } = useQuery({ ...liftSetsQO, refetchInterval });
  const { data: tests = [] } = useQuery({ ...testsQO, refetchInterval });
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const { data: rackSessions = [] } = useTodayRackSessions(autoRefresh);
  const { data: setLogs = [] } = useTodayRackSetLogs(autoRefresh);
  const { data: rackSessionAthletes = [] } = useTodayRackSessionAthletes(autoRefresh);
  const { data: workoutExercises = [] } = useQuery(workoutExercisesQO);
  const { data: workouts = [] } = useQuery(workoutsQO);
  const { data: exercises = [] } = useQuery(exercisesQO);


  const testTypeMeta = useMemo(() => {
    const m = new Map(customTypes.map((c) => [c.value, c]));
    return (v: string) => {
      const c = m.get(v);
      if (c) return { value: c.value, label: c.label, unit: c.unit, lowerIsBetter: c.lower_is_better, group: c.group_name };
      return baseTestTypeMeta(v);
    };
  }, [customTypes]);

  useEffect(() => {
    if (!autoRefresh) return;
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["lifts"] });
      qc.invalidateQueries({ queryKey: ["lift_sets"] });
      qc.invalidateQueries({ queryKey: ["tests"] });
      qc.invalidateQueries({ queryKey: ["cc_rack_set_logs", localDateKey()] });
      qc.invalidateQueries({ queryKey: ["cc_rack_sessions", localDateKey()] });
      qc.invalidateQueries({ queryKey: ["cc_rack_session_athletes", localDateKey()] });
      setLastUpdated(Date.now());
    };
    const ch = supabase
      .channel("command-center")
      .on("postgres_changes", { event: "*", schema: "public", table: "lifts" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_sets" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "tests" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "rack_set_logs" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "rack_sessions" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "rack_session_athletes" }, invalidate)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, autoRefresh]);

  useEffect(() => { setLastUpdated(Date.now()); }, [lifts, liftSets, tests, setLogs, rackSessions]);

  // Lift/test polling only runs while the Leaderboard tab is active (see
  // `refetchInterval` above) — catch up immediately on switching to it so
  // the boards never show stale data from however long the coach was away.
  useEffect(() => {
    if (activeTab !== "leaderboard") return;
    qc.invalidateQueries({ queryKey: ["lifts"] });
    qc.invalidateQueries({ queryKey: ["lift_sets"] });
    qc.invalidateQueries({ queryKey: ["tests"] });
  }, [activeTab, qc]);

  // ---------------- Leaderboard scaffolding (preserved) ----------------
  type LiftSetEntry = {
    athlete_id: string; exercise: string;
    load: number | null; reps: number | null; velocity: number | null;
    timeSeconds: number | null; distanceIn: number | null;
    date: string; createdAt: number;
  };
  const liftSetEntries = useMemo<LiftSetEntry[]>(() => {
    const setsByLift = new Map<string, LiftSet[]>();
    for (const s of liftSets) {
      const arr = setsByLift.get(s.lift_id) ?? [];
      arr.push(s); setsByLift.set(s.lift_id, arr);
    }
    const out: LiftSetEntry[] = [];
    for (const l of lifts as LiftRow[]) {
      const sets = setsByLift.get(l.id);
      const created = new Date((l as { created_at?: string }).created_at ?? l.lift_date).getTime();
      const t = l.time_seconds == null ? null : Number(l.time_seconds);
      const d = l.distance_in == null ? null : Number(l.distance_in);
      if (sets && sets.length) {
        for (const s of sets) out.push({ athlete_id: l.athlete_id, exercise: l.exercise, load: s.load, reps: s.reps, velocity: s.velocity, timeSeconds: t, distanceIn: d, date: l.lift_date, createdAt: created });
      } else {
        out.push({ athlete_id: l.athlete_id, exercise: l.exercise, load: l.load, reps: l.reps, velocity: l.velocity, timeSeconds: t, distanceIn: d, date: l.lift_date, createdAt: created });
      }
    }
    return out;
  }, [lifts, liftSets]);


  // Measurement type per exercise drives which metrics make sense.
  const measureByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of exercises) if (e.name) m.set(e.name, String(e.measurement_type));
    return m;
  }, [exercises]);

  const metricOptions = useMemo<MetricOption[]>(() => {
    const opts: MetricOption[] = [];
    const exerciseNames = new Set<string>();
    for (const e of exercises) if (e.name) exerciseNames.add(e.name);
    // Also include any exercise seen in historical data so ad-hoc lifts always appear.
    for (const e of liftSetEntries) if (e.exercise) exerciseNames.add(e.exercise);

    // Any exercise that has time/distance logged is treated as a speed exercise too.
    const timedNames = new Set<string>();
    const distanceNames = new Set<string>();
    const loadNames = new Set<string>();
    for (const e of liftSetEntries) {
      if (e.timeSeconds != null) timedNames.add(e.exercise);
      if (e.distanceIn != null) distanceNames.add(e.exercise);
      if (e.load != null) loadNames.add(e.exercise);
    }

    for (const exercise of Array.from(exerciseNames).sort((a, b) => a.localeCompare(b))) {
      const measure = measureByName.get(exercise) ?? "load";
      const isMph = measure === "mph";
      const isTimed = measure === "seconds" || isMph || timedNames.has(exercise);
      const isDistance = measure === "inches" || distanceNames.has(exercise);
      const group = isTimed ? "Speed" : isDistance ? "Distance" : "Lifts";
      const push = (metric: LiftMetric, unit: string, lowerIsBetter = false) => opts.push({
        kind: "lift", id: `lift:${exercise}:${metric}`,
        label: `${exercise} — ${LIFT_METRIC_LABELS[metric]}`,
        group, exercise, metric, unit, lowerIsBetter,
      });
      if (isMph) {
        push("mph", "mph");
        if (timedNames.has(exercise)) push("time", "s", true);
      } else if (isTimed) {
        push("time", "s", true);
        push("mph", "mph");
      }
      if (isDistance) push("distance", "in");
      // Anything with weight logged keeps its lifting metrics, even if it's a
      // timed exercise — otherwise those numbers vanish from the board.
      if ((!isTimed && !isDistance) || loadNames.has(exercise)) {
        push("e1rm", "lb");
        push("weight", "lb");
        push("reps", "reps");
        push("velocity", "m/s");
      }
    }



    const testTypes = new Set<string>();
    for (const t of tests) if (t.test_type) testTypes.add(t.test_type);
    for (const tt of Array.from(testTypes).sort()) {
      const meta = testTypeMeta(tt);
      opts.push({ kind: "test", id: `test:${tt}`, label: meta.label, group: `Tests · ${meta.group}`, testType: tt, unit: meta.unit, lowerIsBetter: meta.lowerIsBetter });
    }
    return opts;
  }, [exercises, liftSetEntries, tests, testTypeMeta]);


  const optionsByGroup = useMemo(() => {
    const m = new Map<string, MetricOption[]>();
    for (const o of metricOptions) {
      const arr = m.get(o.group) ?? [];
      arr.push(o); m.set(o.group, arr);
    }
    return Array.from(m.entries());
  }, [metricOptions]);

  const [metricId, setMetricId] = useState<string>("");
  const [metricIdB, setMetricIdB] = useState<string>("");
  const [showSecondBoard, setShowSecondBoard] = useState<boolean>(false);
  const [teamId, setTeamId] = useState<string>("all");
  const [sport, setSport] = useState<string>("all");
  const [showMale, setShowMale] = useState<boolean>(true);
  const [showFemale, setShowFemale] = useState<boolean>(true);
  const [range, setRange] = useState<RangeKind>("today");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [showRosters, setShowRosters] = useLocalStorage<boolean>("sl.commandCenter.showRosters", false);

  useEffect(() => {
    if (metricId && metricOptions.find((o) => o.id === metricId)) return;
    if (!metricOptions.length) return;
    const bounds = rangeBounds(range, dateFrom, dateTo);
    const todayKey = localDateKey();
    const hasDataInRange = (o: MetricOption) => {
      if (o.kind === "test") {
        return tests.some((t) => t.test_type === o.testType && (dateInBounds(t.test_date, bounds) || (range === "today" && timestampDateKey(new Date((t as { created_at?: string }).created_at ?? t.test_date).getTime()) === todayKey)));
      }
      return liftSetEntries.some((e) => e.exercise === o.exercise && (dateInBounds(e.date, bounds) || (range === "today" && timestampDateKey(e.createdAt) === todayKey)));
    };
    setMetricId((metricOptions.find(hasDataInRange) ?? metricOptions[0]).id);
  }, [metricOptions, metricId, range, dateFrom, dateTo, tests, liftSetEntries]);

  const currentMetric = metricOptions.find((o) => o.id === metricId) ?? null;
  const currentMetricB = metricOptions.find((o) => o.id === metricIdB) ?? null;
  const athleteById = useMemo(() => new Map(athletes.map((a) => [a.id, a as Athlete])), [athletes]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const workoutExerciseById = useMemo(() => new Map(workoutExercises.map((w) => [w.id, w])), [workoutExercises]);
  const workoutById = useMemo(() => new Map(workouts.map((w) => [w.id, w])), [workouts]);

  const entriesFor = useMemo(() => {
    return (metric: MetricOption | null): Entry[] => {
      if (!metric) return [];
      const out: Entry[] = [];
      if (metric.kind === "lift") {
        for (const e of liftSetEntries) {
          if (e.exercise !== metric.exercise) continue;
          let v: number | null = null;
          switch (metric.metric) {
            case "e1rm": if (e.load != null && e.reps != null && e.reps > 0) v = epley(Number(e.load), Number(e.reps)); break;
            case "weight": if (e.load != null) v = Number(e.load); break;
            case "reps": if (e.reps != null) v = Number(e.reps); break;
            case "velocity": if (e.velocity != null) v = Number(e.velocity); break;
            case "time": if (e.timeSeconds != null && Number(e.timeSeconds) > 0) v = Number(e.timeSeconds); break;
            case "distance": if (e.distanceIn != null) v = Number(e.distanceIn); break;
            case "mph": {
              const t = e.timeSeconds == null ? null : Number(e.timeSeconds);
              // 1) explicit distance + time, 2) zone distance implied by the
              // exercise name (e.g. "30/10 Fly" = 10 yd), 3) mph logged directly
              // into the load field for mph-measured exercises.
              const inches = e.distanceIn != null ? Number(e.distanceIn) : impliedZoneInches(e.exercise);
              if (t != null && t > 0 && inches != null && inches > 0) {
                v = (inches / t) * 0.0568182;
              } else if (measureByName.get(e.exercise) === "mph" && e.load != null) {
                v = Number(e.load);
              }
              break;
            }


          }
          if (v == null) continue;
          out.push({ athlete_id: e.athlete_id, value: v, date: e.date, createdAt: e.createdAt });
        }
        return out;
      }
      for (const t of tests as TestRow[]) {
        if (t.test_type !== metric.testType) continue;
        if (t.value == null) continue;
        const created = new Date((t as { created_at?: string }).created_at ?? t.test_date).getTime();
        out.push({ athlete_id: t.athlete_id, value: Number(t.value), date: t.test_date, createdAt: created });
      }
      return out;
    };
  }, [liftSetEntries, tests, measureByName]);

  const bounds = useMemo(() => rangeBounds(range, dateFrom, dateTo), [range, dateFrom, dateTo]);

  type BoardRow = { athlete: Athlete; value: number; date: string; pct: number; isPR: boolean; recentPR: boolean };

  const buildRowsFor = (metric: MetricOption | null, gender: string | null): BoardRow[] => {
    if (!metric) return [];
    const metricEntries = entriesFor(metric);
    const teamFilter = teamId === "all" ? null : teamId;
    const lower = metric.lowerIsBetter;
    const better = (a: number, b: number) => (lower ? a < b : a > b);
    type Agg = { best: number; bestEntry: Entry | null; window: number; windowEntry: Entry | null };
    const init = (): Agg => ({ best: lower ? Infinity : -Infinity, bestEntry: null, window: lower ? Infinity : -Infinity, windowEntry: null });
    const perAth = new Map<string, Agg>();
    const todayKey = localDateKey();
    for (const e of metricEntries) {
      const a = athleteById.get(e.athlete_id);
      if (!a) continue;
      if (teamFilter && a.team_id !== teamFilter) continue;
      if (sport !== "all" && a.sport !== sport) continue;
      if (gender && (a.gender ?? null) !== gender) continue;
      const loggedToday = range === "today" && timestampDateKey(e.createdAt) === todayKey;
      const inWindow = dateInBounds(e.date, bounds) || loggedToday;
      const cur = perAth.get(e.athlete_id) ?? init();
      if (cur.bestEntry == null || better(e.value, cur.best)) { cur.best = e.value; cur.bestEntry = e; }
      if (inWindow && (cur.windowEntry == null || better(e.value, cur.window))) { cur.window = e.value; cur.windowEntry = e; }
      perAth.set(e.athlete_id, cur);
    }
    const nowMs = Date.now();
    const items: BoardRow[] = [];
    for (const [id, agg] of perAth.entries()) {
      if (!agg.windowEntry) continue;
      const athlete = athleteById.get(id)!;
      let pct = 0;
      if (agg.best !== 0 && Number.isFinite(agg.best)) pct = lower ? (agg.best / agg.window) * 100 : (agg.window / agg.best) * 100;
      const isPR = agg.windowEntry === agg.bestEntry;
      const recentPR = isPR && (nowMs - agg.windowEntry.createdAt) < 1000 * 60 * 60 * 24 * 3;
      items.push({ athlete, value: agg.window, date: agg.windowEntry.date, pct, isPR, recentPR });
    }
    items.sort((a, b) => (lower ? a.value - b.value : b.value - a.value));
    return items;
  };

  // Gender columns: none checked = one combined board.
  const genderCols = useMemo<{ key: string; label: string; gender: string | null }[]>(() => {
    const cols: { key: string; label: string; gender: string | null }[] = [];
    if (showMale) cols.push({ key: "male", label: "Male", gender: "male" });
    if (showFemale) cols.push({ key: "female", label: "Female", gender: "female" });
    if (cols.length === 0) cols.push({ key: "all", label: "All Athletes", gender: null });
    return cols;
  }, [showMale, showFemale]);


  // ---------------- Command Center derived data ----------------

  const teamName = (id: string | null) => (id ? teamById.get(id)?.name ?? "—" : "—");

  // Best e1RM per athlete/exercise BEFORE today — for PR detection today.
  const preTodayBestByAthEx = useMemo(() => {
    const todayKey = localDateKey();
    const m = new Map<string, number>();
    for (const e of liftSetEntries) {
      if (!e.exercise || e.load == null || !e.reps || e.reps <= 0) continue;
      if (e.date >= todayKey) continue;
      const key = `${e.athlete_id}::${e.exercise.toLowerCase()}`;
      const v = epley(Number(e.load), Number(e.reps));
      const cur = m.get(key);
      if (cur == null || v > cur) m.set(key, v);
    }
    return m;
  }, [liftSetEntries]);

  type FeedItem = {
    id: string; kind: "set" | "pr" | "flag" | "review" | "done";
    athlete: Athlete | null; athleteName: string;
    exercise: string; workoutName: string | null;
    load: number | null; reps: number | null; velocity: number | null; e1rm: number | null;
    ts: number; status: string; approval: string; validation: string;
    rackNumber: number | null; teamName: string | null;
    isPR: boolean; delta: number | null;
  };

  const rackByExId = useMemo(() => new Map(rackSessions.map((r) => [r.id, r])), [rackSessions]);

  const feed = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = [];
    for (const log of setLogs) {
      const ath = athleteById.get(log.athlete_id) ?? null;
      const wex = workoutExerciseById.get(log.workout_exercise_id);
      const exerciseName = wex?.exercise_name ?? "Exercise";
      const rack = rackByExId.get(log.rack_session_id);
      const ts = new Date(log.completed_at || log.created_at).getTime();
      const e1rm = log.estimated_1rm != null ? Number(log.estimated_1rm)
        : (log.load != null && log.reps && log.reps > 0 ? epley(Number(log.load), Number(log.reps)) : null);
      const prevBest = preTodayBestByAthEx.get(`${log.athlete_id}::${exerciseName.toLowerCase()}`);
      const isPR = e1rm != null && e1rm > (prevBest ?? 0) && (log.approval_status !== "rejected");
      // Only counts as a measurable "increase" when there was a real prior
      // best to compare against — a first-ever log isn't an improvement.
      const delta = isPR && e1rm != null && prevBest != null ? e1rm - prevBest : null;
      const flagged = log.validation_status && log.validation_status !== "ok" && log.validation_status !== "";
      const pending = log.approval_status === "pending" || log.approval_status === "needs_review";
      let kind: FeedItem["kind"] = "set";
      if (flagged) kind = "flag";
      else if (isPR) kind = "pr";
      else if (pending) kind = "review";
      out.push({
        id: log.id, kind,
        athlete: ath, athleteName: ath ? athleteDisplayName(ath) : "Unknown",
        exercise: exerciseName,
        workoutName: rack?.workout_id ? workoutById.get(rack.workout_id)?.name ?? null : null,
        load: log.load, reps: log.reps,
        velocity: log.peak_velocity ?? log.avg_velocity ?? null,
        e1rm, ts,
        status: log.status, approval: log.approval_status, validation: log.validation_status,
        rackNumber: rack?.rack_number ?? null,
        teamName: rack?.team_id ? teamById.get(rack.team_id)?.name ?? null : null,
        isPR, delta,
      });
    }
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }, [setLogs, athleteById, workoutExerciseById, rackByExId, workoutById, teamById, preTodayBestByAthEx]);

  // Per-rack aggregate for the rack grid.
  type RackCard = {
    session: RackSessionRow;
    activeAthlete: Athlete | null;
    athletes: Athlete[];
    athleteCount: number;
    lastLog: FeedItem | null;
    setsLogged: number;
    setsPrescribed: number;
    completionPct: number;
    currentExercise: string | null;
    lastLoggedMs: number | null;
    isPR: boolean;
    flagged: boolean;
    needsReview: boolean;
  };

  const rackCards = useMemo<RackCard[]>(() => {
    const logBySession = new Map<string, FeedItem[]>();
    for (const log of setLogs) {
      const f = feed.find((x) => x.id === log.id);
      if (!f) continue;
      const arr = logBySession.get(log.rack_session_id) ?? [];
      arr.push(f); logBySession.set(log.rack_session_id, arr);
    }
    // Prescribed set count per session = distinct workout_exercise_id * their set count
    const prescribedBySession = new Map<string, number>();
    for (const s of rackSessions) {
      if (!s.workout_id) { prescribedBySession.set(s.id, 0); continue; }
      const exs = workoutExercises.filter((e) => e.workout_id === s.workout_id);
      const setsPerAthlete = exs.reduce((n, e) => n + Math.max(1, e.sets ?? 1), 0);
      prescribedBySession.set(s.id, setsPerAthlete * Math.max(1, s.athlete_ids?.length ?? 0));
    }
    return rackSessions.map<RackCard>((s) => {
      const logs = (logBySession.get(s.id) ?? []).sort((a, b) => b.ts - a.ts);
      const lastLog = logs[0] ?? null;
      const setsLogged = logs.length;
      const setsPrescribed = prescribedBySession.get(s.id) ?? 0;
      const completionPct = setsPrescribed > 0 ? Math.min(100, (setsLogged / setsPrescribed) * 100) : 0;
      const activeAthlete = s.active_athlete_id ? athleteById.get(s.active_athlete_id) ?? null : null;
      const athletes = (s.athlete_ids ?? [])
        .map((id) => athleteById.get(id))
        .filter((a): a is Athlete => !!a)
        .sort((a, b) => athleteDisplayName(a).localeCompare(athleteDisplayName(b)));
      const flagged = logs.some((l) => l.kind === "flag");
      const needsReview = logs.some((l) => l.kind === "review");
      const isPR = logs.some((l) => l.kind === "pr" && (Date.now() - l.ts) < JUST_LOGGED_MS);
      return {
        session: s,
        activeAthlete,
        athletes,
        athleteCount: s.athlete_ids?.length ?? 0,
        lastLog,
        setsLogged,
        setsPrescribed,
        completionPct,
        currentExercise: lastLog?.exercise ?? null,
        lastLoggedMs: lastLog?.ts ?? null,
        isPR,
        flagged,
        needsReview,
      };
    });
  }, [rackSessions, setLogs, feed, workoutExercises, athleteById]);

  // Per-athlete session status: opened/still-active/not-logged, for the
  // Session Status panel. rack_session_athletes carries the open/heartbeat
  // timestamps; setLogs (already loaded for the feed) tells us who's
  // actually logged anything today.
  type AthleteSessionStatus = {
    athleteId: string; athlete: Athlete | null;
    rackNumber: number | null; teamName: string | null;
    openedAt: number | null; lastSeenAt: number | null; setsLogged: number;
  };
  const sessionStatuses = useMemo<AthleteSessionStatus[]>(() => {
    const sessionById = new Map(rackSessions.map((s) => [s.id, s]));
    const setsByAthleteSession = new Map<string, number>();
    for (const l of setLogs) {
      const key = `${l.rack_session_id}:${l.athlete_id}`;
      setsByAthleteSession.set(key, (setsByAthleteSession.get(key) ?? 0) + 1);
    }
    return rackSessionAthletes.map((row) => {
      const session = sessionById.get(row.rack_session_id);
      return {
        athleteId: row.athlete_id,
        athlete: athleteById.get(row.athlete_id) ?? null,
        rackNumber: session?.rack_number ?? null,
        teamName: session?.team_id ? teamById.get(session.team_id)?.name ?? null : null,
        openedAt: row.opened_at ? new Date(row.opened_at).getTime() : null,
        lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).getTime() : null,
        setsLogged: setsByAthleteSession.get(`${row.rack_session_id}:${row.athlete_id}`) ?? 0,
      };
    });
  }, [rackSessionAthletes, rackSessions, setLogs, athleteById, teamById]);

  // KPI metrics for the header strip.
  const todayKey = localDateKey();
  const activeAthleteIds = new Set<string>();
  for (const s of rackSessions) for (const id of s.athlete_ids ?? []) activeAthleteIds.add(id);
  const athletesLoggingIds = new Set<string>();
  for (const l of setLogs) athletesLoggingIds.add(l.athlete_id);
  const finishedAthletes = rackCards.reduce((n, r) => n + (r.setsPrescribed > 0 && r.completionPct >= 100 ? r.athleteCount : 0), 0);
  const setsLoggedToday = setLogs.length;
  const prsToday = feed.filter((f) => f.isPR).length;
  const flaggedToday = feed.filter((f) => f.kind === "flag" || f.approval === "pending" || f.approval === "needs_review").length;
  const totalPrescribed = rackCards.reduce((n, r) => n + r.setsPrescribed, 0);
  const overallCompletion = totalPrescribed > 0 ? Math.min(100, (setsLoggedToday / totalPrescribed) * 100) : 0;
  const teamsTraining = new Set(rackSessions.map((s) => s.team_id)).size;

  const secondsAgo = Math.max(0, Math.floor((now - lastUpdated) / 1000));

  return (
    <div className="space-y-5">
      {/* ============== COMMAND HEADER ============== */}
      <CommandHeader
        now={now}
        secondsAgo={secondsAgo}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
      />

      {/* ============== KPI STRIP ============== */}
      <KpiStrip
        items={[
          { label: "Racks Active", value: rackSessions.length, icon: <Dumbbell className="h-4 w-4" /> },
          { label: "Athletes Active", value: activeAthleteIds.size, icon: <Users className="h-4 w-4" /> },
          { label: "Logging Now", value: athletesLoggingIds.size, tone: "info", icon: <Zap className="h-4 w-4" /> },
          { label: "Finished", value: finishedAthletes, tone: "pr", icon: <CheckCircle2 className="h-4 w-4" /> },
          { label: "Sets Today", value: setsLoggedToday, icon: <Activity className="h-4 w-4" /> },
          { label: "PRs Today", value: prsToday, tone: "pr", icon: <Flame className="h-4 w-4" /> },
          { label: "Needs Review", value: flaggedToday, tone: flaggedToday > 0 ? "warn" : "neutral", icon: <AlertTriangle className="h-4 w-4" /> },
          { label: "Completion", value: `${Math.round(overallCompletion)}%`, tone: "info", icon: <Trophy className="h-4 w-4" /> },
          { label: "Teams", value: teamsTraining, icon: <Users className="h-4 w-4" /> },
        ]}
      />

      {/* ============== TABS ============== */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as CommandCenterTab)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="live"><Activity className="mr-1.5 h-3.5 w-3.5" /> Live Now</TabsTrigger>
          <TabsTrigger value="leaderboard"><Trophy className="mr-1.5 h-3.5 w-3.5" /> Leaderboard</TabsTrigger>
          <TabsTrigger value="workout"><Dumbbell className="mr-1.5 h-3.5 w-3.5" /> Today's Workout</TabsTrigger>
        </TabsList>

        {/* ---------- LIVE NOW ---------- */}
        <TabsContent value="live" className="space-y-5">
          <RackGrid cards={rackCards} now={now} showRosters={showRosters} onShowRostersChange={setShowRosters} />
          <div className="grid gap-5 xl:grid-cols-3">
            <div className="space-y-5 xl:col-span-2">
              <ActivityFeedPanel feed={feed} now={now} />
            </div>
            <div className="space-y-5">
              <SessionStatusPanel statuses={sessionStatuses} now={now} />
              <CoachAttentionPanel feed={feed} rackCards={rackCards} />
            </div>
          </div>
        </TabsContent>

        {/* ---------- LEADERBOARD ---------- */}
        <TabsContent value="leaderboard" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="eyebrow">Leaderboards</h2>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs">
                <span className="text-muted-foreground">2nd Board</span>
                <Switch
                  checked={showSecondBoard}
                  onCheckedChange={(v) => { setShowSecondBoard(v); if (v && !metricIdB) { const alt = metricOptions.find((o) => o.id !== metricId); if (alt) setMetricIdB(alt.id); } }}
                />
              </label>
              <Button size="sm" variant={showFilters ? "default" : "outline"} onClick={() => setShowFilters((v) => !v)}>
                <Filter className="mr-1 h-3.5 w-3.5" /> Filters
              </Button>
            </div>
          </div>

          {showFilters && (
            <Card className="card-elevated">
              <CardContent className="p-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="lg:col-span-2">
                    <Label>Metric</Label>
                    <Select value={metricId} onValueChange={setMetricId}>
                      <SelectTrigger><SelectValue placeholder="Pick a metric…" /></SelectTrigger>
                      <SelectContent>
                        {metricOptions.length === 0
                          ? <div className="px-2 py-2 text-sm text-muted-foreground">No lifts or tests logged yet</div>
                          : optionsByGroup.map(([group, opts]) => (
                              <SelectGroup key={group}>
                                <SelectLabel>{group}</SelectLabel>
                                {opts.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                              </SelectGroup>
                            ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Team</Label>
                    <Select value={teamId} onValueChange={setTeamId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Teams</SelectItem>
                        {teams.map((t: Team) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Sport</Label>
                    <Select value={sport} onValueChange={setSport}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Sports</SelectItem>
                        {SPORTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Date Range</Label>
                    <Select value={range} onValueChange={(v) => setRange(v as RangeKind)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(RANGE_LABELS) as RangeKind[]).map((k) => (
                          <SelectItem key={k} value={k}>{RANGE_LABELS[k]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="lg:col-span-2">
                    <Label>Gender boards</Label>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {([
                        { label: "Male", on: showMale, set: setShowMale },
                        { label: "Female", on: showFemale, set: setShowFemale },
                      ]).map((g) => (
                        <button
                          key={g.label}
                          type="button"
                          onClick={() => g.set(!g.on)}
                          className={cn(
                            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                            g.on ? "border-primary bg-primary/10 text-foreground" : "border-input bg-background text-muted-foreground",
                          )}
                        >
                          <span className={cn(
                            "flex h-4 w-4 items-center justify-center rounded-[4px] border",
                            g.on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                          )}>
                            {g.on && <CheckCircle2 className="h-3 w-3" />}
                          </span>
                          {g.label}
                        </button>
                      ))}
                      <span className="self-center text-xs text-muted-foreground">
                        {showMale && showFemale ? "Split boards" : showMale || showFemale ? "Single board" : "Combined (all athletes)"}
                      </span>
                    </div>
                  </div>
                  <div className="lg:col-span-2">
                    <Label>Second metric (optional)</Label>
                    <div className="flex gap-2">
                      <Select value={metricIdB} onValueChange={(v) => { setMetricIdB(v); setShowSecondBoard(true); }}>
                        <SelectTrigger><SelectValue placeholder="Pick a second metric…" /></SelectTrigger>
                        <SelectContent>
                          {optionsByGroup.map(([group, opts]) => (
                            <SelectGroup key={group}>
                              <SelectLabel>{group}</SelectLabel>
                              {opts.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                      {metricIdB && (
                        <Button variant="outline" onClick={() => { setMetricIdB(""); setShowSecondBoard(false); }}>Clear</Button>
                      )}
                    </div>
                  </div>
                  {range === "custom" && (
                    <>
                      <div><Label>From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
                      <div><Label>To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-5 xl:grid-cols-3">
            <div className="space-y-5 xl:col-span-2">
              {[
                { metric: currentMetric, show: true },
                { metric: currentMetricB, show: showSecondBoard },
              ]
                .filter((b) => b.show && b.metric)
                .map((b, i) => (
                  <div
                    key={`board-${i}-${b.metric!.id}`}
                    className={cn("grid gap-4", genderCols.length > 1 && "lg:grid-cols-2")}
                  >
                    {genderCols.map((g) => (
                      <BoardPanel
                        key={`${b.metric!.id}-${g.key}`}
                        title={genderCols.length > 1 ? `${g.label} — ${b.metric!.label}` : b.metric!.label}
                        icon
                        rows={buildRowsFor(b.metric!, g.gender)}
                        unit={b.metric!.unit}
                        metricLabel={genderCols.length > 1 ? b.metric!.label : g.label}
                        teamLabel={teamId === "all" ? "All" : teamName(teamId)}
                        sport={sport}
                        range={range}
                      />
                    ))}
                  </div>
                ))}
            </div>
            <div className="space-y-5">
              <PRFeedPanel feed={feed} now={now} />
            </div>
          </div>
        </TabsContent>

        {/* ---------- TODAY'S WORKOUT ---------- */}
        <TabsContent value="workout" className="space-y-5">
          <div className="max-w-xs">
            <Label>Team</Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Teams</SelectItem>
                {teams.map((t: Team) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <TodaysWorkoutPanel teamId={teamId} athletes={athletes} teams={teams} />
        </TabsContent>
      </Tabs>

      <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <RefreshCw className={cn("h-3 w-3", autoRefresh && "animate-spin")} /> Last updated: {secondsAgo}s ago · Auto-refresh {autoRefresh ? "on" : "paused"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function CommandHeader({
  now, secondsAgo, autoRefresh, onAutoRefreshChange,
}: {
  now: number; secondsAgo: number;
  autoRefresh: boolean; onAutoRefreshChange: (v: boolean) => void;
}) {
  const d = new Date(now);
  const clock = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateStr = d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  return (
    <header className="card-elevated grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl p-4 sm:p-5">
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-3">
          <span className="eyebrow">Command Center</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-destructive">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
            </span>
            Live
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="stat-number text-3xl sm:text-5xl">{clock}</h1>
          <span className="text-sm font-medium text-muted-foreground sm:text-base">{dateStr}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
        <div className="hidden text-right text-xs text-muted-foreground sm:block">
          <div className="font-medium text-foreground">{secondsAgo}s ago</div>
          <div>Last refresh</div>
        </div>
        <label className="flex items-center gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs">
          <span className="text-muted-foreground">Auto</span>
          <Switch checked={autoRefresh} onCheckedChange={onAutoRefreshChange} />
        </label>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// KPI Strip
// ---------------------------------------------------------------------------

type KpiTone = "neutral" | "pr" | "warn" | "info";
function KpiStrip({ items }: { items: Array<{ label: string; value: string | number; tone?: KpiTone; icon?: React.ReactNode }> }) {
  const toneCls: Record<KpiTone, string> = {
    neutral: "text-foreground",
    pr: "text-[color:var(--status-pr)]",
    warn: "text-[color:var(--status-near)]",
    info: "text-[color:var(--status-info)]",
  };
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-9">
      {items.map((k) => (
        <div key={k.label} className="card-elevated rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {k.icon}
            <span className="truncate">{k.label}</span>
          </div>
          <div className={cn("stat-number mt-1 text-2xl", toneCls[k.tone ?? "neutral"])}>{k.value}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rack Grid
// ---------------------------------------------------------------------------

type RackCardProps = {
  session: RackSessionRow;
  activeAthlete: Athlete | null;
  athletes: Athlete[];
  athleteCount: number;
  lastLog: {
    ts: number; kind: string; exercise: string;
    load: number | null; reps: number | null; velocity: number | null;
    athleteName: string; approval: string; validation: string;
  } | null;
  setsLogged: number;
  setsPrescribed: number;
  completionPct: number;
  currentExercise: string | null;
  lastLoggedMs: number | null;
  isPR: boolean;
  flagged: boolean;
  needsReview: boolean;
};

function RackGrid({
  cards, now, showRosters, onShowRostersChange,
}: {
  cards: RackCardProps[]; now: number;
  showRosters: boolean; onShowRostersChange: (v: boolean) => void;
}) {
  if (!cards.length) {
    return (
      <Card className="card-elevated">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Dumbbell className="h-4 w-4 text-primary" /> Rack Floor
          </CardTitle>
        </CardHeader>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No racks running yet today. Open the <Link to="/rack-console" className="text-primary underline">Rack Console</Link> to start a session.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow">Rack Floor · {cards.length} active</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs">
            <span className="text-muted-foreground">Show Rosters</span>
            <Switch checked={showRosters} onCheckedChange={onShowRostersChange} />
          </label>
          <Link to="/rack-console" className="text-xs text-primary hover:underline">Open Rack Console →</Link>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.sort((a, b) => a.session.rack_number - b.session.rack_number).map((c) => (
          <RackCardView key={c.session.id} card={c} now={now} showRosters={showRosters} />
        ))}
      </div>
    </div>
  );
}

function RackCardView({ card, now, showRosters }: { card: RackCardProps; now: number; showRosters: boolean }) {
  const justLogged = card.lastLoggedMs != null && (now - card.lastLoggedMs) < JUST_LOGGED_MS;
  const ringCls =
    card.flagged ? "ring-2 ring-[color:var(--status-below)]/60"
    : card.isPR ? "ring-2 ring-[color:var(--status-pr)]/70 card-glow"
    : card.needsReview ? "ring-2 ring-[color:var(--status-near)]/60"
    : justLogged ? "ring-2 ring-primary/50"
    : "";
  const pulseCls = justLogged ? "animate-pulse-slow" : "";
  return (
    <div className={cn("card-elevated group relative overflow-hidden rounded-xl p-3 transition-all", ringCls, pulseCls)}>
      {justLogged && (
        <span className="absolute right-2 top-2 z-10 rounded-full brand-gradient px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest">
          Just Logged
        </span>
      )}
      <div className="flex items-center gap-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg brand-bg text-sm font-bold">
          R{card.session.rack_number}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {card.activeAthlete ? athleteDisplayName(card.activeAthlete) : `${card.athleteCount} athlete${card.athleteCount === 1 ? "" : "s"}`}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {card.currentExercise ?? "Waiting to start"}
          </div>
        </div>
      </div>

      {showRosters && card.athletes.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {card.athletes.map((a) => {
            const isActive = a.id === card.activeAthlete?.id;
            return (
              <span
                key={a.id}
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] leading-tight",
                  isActive ? "bg-primary/15 font-semibold text-primary" : "bg-muted text-muted-foreground",
                )}
                title={isActive ? "Currently logging" : undefined}
              >
                {athleteDisplayName(a)}
              </span>
            );
          })}
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>Progress</span>
          <span className="mono-number text-foreground">{card.setsLogged}/{card.setsPrescribed || "—"}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              card.completionPct >= 100 ? "bg-[color:var(--status-pr)]" : "brand-gradient",
            )}
            style={{ width: `${Math.max(card.completionPct, card.setsLogged > 0 ? 4 : 0)}%` }}
          />
        </div>
      </div>

      {card.lastLog && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-[11px]">
          <span className="mono-number text-foreground">
            {card.lastLog.load != null ? `${card.lastLog.load}lb` : "—"} × {card.lastLog.reps ?? "—"}
            {card.lastLog.velocity != null && <span className="ml-1 text-muted-foreground">· {card.lastLog.velocity.toFixed(2)}m/s</span>}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Timer className="h-3 w-3" /> {timeAgo(card.lastLog.ts, now)}
          </span>
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5 text-[10px]">
        {card.isPR && <Badge tone="pr">PR</Badge>}
        {card.flagged && <Badge tone="bad">Flagged</Badge>}
        {card.needsReview && <Badge tone="warn">Review</Badge>}
        {!card.isPR && !card.flagged && !card.needsReview && card.completionPct >= 100 && <Badge tone="pr">Complete</Badge>}
      </div>
    </div>
  );
}

function Badge({ tone, children }: { tone: "pr" | "warn" | "bad" | "info"; children: React.ReactNode }) {
  const map = {
    pr: "bg-[color:var(--status-pr)]/15 text-[color:var(--status-pr)]",
    warn: "bg-[color:var(--status-near)]/15 text-[color:var(--status-near)]",
    bad: "bg-[color:var(--status-below)]/15 text-[color:var(--status-below)]",
    info: "bg-[color:var(--status-info)]/15 text-[color:var(--status-info)]",
  } as const;
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", map[tone])}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Coach Attention
// ---------------------------------------------------------------------------

type FeedItem = {
  id: string; kind: "set" | "pr" | "flag" | "review" | "done";
  athlete: Athlete | null; athleteName: string;
  exercise: string; workoutName: string | null;
  load: number | null; reps: number | null; velocity: number | null; e1rm: number | null;
  ts: number; status: string; approval: string; validation: string;
  rackNumber: number | null; teamName: string | null;
  isPR: boolean; delta: number | null;
};

// ---------------------------------------------------------------------------
// Session Status — who has opened today's session, who's still active, and
// who hasn't logged anything (lit up red).
// ---------------------------------------------------------------------------

const SESSION_LIVE_MS = 90_000; // 2x the athlete-side heartbeat interval
const SESSION_JUST_OPENED_MS = 30 * 60_000;

function SessionStatusPanel({ statuses, now }: {
  statuses: { athleteId: string; athlete: Athlete | null; rackNumber: number | null; teamName: string | null; openedAt: number | null; lastSeenAt: number | null; setsLogged: number }[];
  now: number;
}) {
  const rows = useMemo(() => {
    return statuses
      .map((s) => ({
        ...s,
        liveNow: s.lastSeenAt != null && (now - s.lastSeenAt) < SESSION_LIVE_MS,
        justOpened: s.openedAt != null && (now - s.openedAt) < SESSION_JUST_OPENED_MS,
        notLogged: s.setsLogged === 0,
      }))
      .sort((a, b) => {
        if (a.notLogged !== b.notLogged) return a.notLogged ? -1 : 1;
        if (a.liveNow !== b.liveNow) return a.liveNow ? -1 : 1;
        const an = a.athlete ? athleteDisplayName(a.athlete) : "";
        const bn = b.athlete ? athleteDisplayName(b.athlete) : "";
        return an.localeCompare(bn);
      });
  }, [statuses, now]);

  const notLoggedCount = rows.filter((r) => r.notLogged).length;
  const liveCount = rows.filter((r) => r.liveNow).length;
  const openedRecentCount = rows.filter((r) => r.justOpened).length;

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Timer className="h-4 w-4 text-[color:var(--status-info)]" /> Session Status
        </CardTitle>
        {rows.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              <span className="mono-number font-semibold text-[color:var(--status-below)]">{notLoggedCount}</span> not logged
            </span>
            <span>
              <span className="mono-number font-semibold text-[color:var(--status-pr)]">{liveCount}</span> active now
            </span>
            <span>
              <span className="mono-number font-semibold text-foreground">{openedRecentCount}</span> opened &lt;30m
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent className="max-h-72 space-y-1 overflow-y-auto pt-0">
        {rows.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">No athletes assigned to a rack session today.</div>
        ) : rows.map((r) => {
          const name = r.athlete ? athleteDisplayName(r.athlete) : "Unknown";
          return (
            <div
              key={r.athleteId}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm",
                r.notLogged ? "border-[color:var(--status-below)]/40 bg-[color:var(--status-below)]/10" : "border-transparent",
              )}
            >
              <Avatar athlete={r.athlete} name={name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{name}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {r.rackNumber ? `Rack ${r.rackNumber}` : "—"}
                  {r.openedAt == null ? " · Not opened" : ` · Opened ${timeAgo(r.openedAt, now)}`}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {r.liveNow && <Badge tone="pr">Live</Badge>}
                {r.notLogged ? (
                  <div className="mt-0.5 text-[10px] font-semibold text-[color:var(--status-below)]">No sets logged</div>
                ) : (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{r.setsLogged} set{r.setsLogged === 1 ? "" : "s"}</div>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function CoachAttentionPanel({ feed, rackCards }: { feed: FeedItem[]; rackCards: RackCardProps[] }) {
  const flagged = feed.filter((f) => f.kind === "flag");
  const review = feed.filter((f) => f.approval === "pending" || f.approval === "needs_review");
  const noVelocity = feed.filter((f) => f.velocity == null && f.load != null);
  const stalledRacks = rackCards.filter((r) => r.setsPrescribed > 0 && r.completionPct < 100 && (!r.lastLoggedMs || (Date.now() - r.lastLoggedMs) > 10 * 60_000));

  const items = [
    { label: "Flagged Entries", count: flagged.length, to: "/log-review", tone: "bad" as const },
    { label: "Awaiting Approval", count: review.length, to: "/log-review", tone: "warn" as const },
    { label: "Missing Velocity", count: noVelocity.length, to: "/log-review", tone: "info" as const },
    { label: "Idle Racks (>10m)", count: stalledRacks.length, to: "/rack-console", tone: "warn" as const },
  ];

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-[color:var(--status-near)]" /> Coach Attention
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0">
        {items.map((it) => (
          <Link
            key={it.label}
            to={it.to}
            className={cn(
              "flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/60",
              it.count === 0 ? "text-muted-foreground" : "text-foreground",
            )}
          >
            <span>{it.label}</span>
            <span className={cn(
              "stat-number text-lg",
              it.count === 0 ? "text-muted-foreground/60"
                : it.tone === "bad" ? "text-[color:var(--status-below)]"
                : it.tone === "warn" ? "text-[color:var(--status-near)]"
                : "text-[color:var(--status-info)]",
            )}>{it.count}</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PR Feed
// ---------------------------------------------------------------------------

function PRFeedPanel({ feed, now }: { feed: FeedItem[]; now: number }) {
  const [lift, setLift] = useState("all");
  const allPRs = useMemo(() => feed.filter((f) => f.isPR), [feed]);
  const lifts = useMemo(
    () => Array.from(new Set(allPRs.map((f) => f.exercise))).sort((a, b) => a.localeCompare(b)),
    [allPRs],
  );
  const filtered = useMemo(
    () => (lift === "all" ? allPRs : allPRs.filter((f) => f.exercise === lift)),
    [allPRs, lift],
  );
  const avgIncrease = useMemo(() => {
    const deltas = filtered.map((f) => f.delta).filter((d): d is number => d != null);
    return deltas.length ? deltas.reduce((s, d) => s + d, 0) / deltas.length : null;
  }, [filtered]);
  const prs = filtered.slice(0, 8);

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Flame className="h-4 w-4 text-[color:var(--status-pr)]" /> Live PRs Today
          </CardTitle>
          {lifts.length > 0 && (
            <Select value={lift} onValueChange={setLift}>
              <SelectTrigger className="h-7 w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All lifts</SelectItem>
                {lifts.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        {allPRs.length > 0 && (
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              <span className="mono-number font-semibold text-foreground">{filtered.length}</span> PR{filtered.length === 1 ? "" : "s"}
            </span>
            <span>
              Avg increase{" "}
              <span className="mono-number font-semibold text-[color:var(--status-pr)]">
                {avgIncrease == null ? "—" : `+${Math.round(avgIncrease)} lb`}
              </span>
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0">
        {prs.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {allPRs.length === 0 ? "No PRs yet today. Keep watching." : "No PRs yet today for this lift."}
          </div>
        ) : prs.map((p) => {
          const fresh = (now - p.ts) < JUST_LOGGED_MS;
          return (
            <div key={p.id} className={cn(
              "flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm transition-all",
              fresh && "border-[color:var(--status-pr)]/40 bg-[color:var(--status-pr)]/10 animate-pulse-slow",
            )}>
              <Avatar athlete={p.athlete} name={p.athleteName} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.athleteName}</div>
                <div className="truncate text-[10px] text-muted-foreground">{p.exercise}</div>
              </div>
              <div className="text-right">
                <div className="mono-number text-sm font-bold text-[color:var(--status-pr)]">
                  {p.e1rm ? `${Math.round(p.e1rm)}lb` : `${p.load}×${p.reps}`}
                  {p.delta != null && <span className="ml-1 text-[10px] font-semibold">+{Math.round(p.delta)}</span>}
                </div>
                <div className="text-[10px] text-muted-foreground">{timeAgo(p.ts, now)}</div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Activity Feed
// ---------------------------------------------------------------------------

function ActivityFeedPanel({ feed, now }: { feed: FeedItem[]; now: number }) {
  const items = feed.slice(0, 18);
  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4 text-primary" /> Live Activity Feed
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">Waiting for the first set of the day…</div>
        ) : (
          <ol className="relative space-y-2 border-l border-border pl-4">
            {items.map((f) => {
              const fresh = (now - f.ts) < JUST_LOGGED_MS;
              const dotColor =
                f.kind === "pr" ? "bg-[color:var(--status-pr)]"
                : f.kind === "flag" ? "bg-[color:var(--status-below)]"
                : f.kind === "review" ? "bg-[color:var(--status-near)]"
                : "bg-primary";
              return (
                <li key={f.id} className={cn(
                  "relative rounded-md px-2 py-1.5 text-xs transition-all",
                  fresh && "bg-primary/5",
                )}>
                  <span className={cn("absolute -left-[21px] top-2 h-2.5 w-2.5 rounded-full ring-2 ring-background", dotColor, fresh && "animate-pulse-slow")} />
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">{f.athleteName}</span>
                    {f.kind === "pr" && <Badge tone="pr">PR</Badge>}
                    {f.kind === "flag" && <Badge tone="bad">Flag</Badge>}
                    {f.kind === "review" && <Badge tone="warn">Review</Badge>}
                    {f.rackNumber != null && <span className="text-muted-foreground">R{f.rackNumber}</span>}
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" /> {timeAgo(f.ts, now)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-muted-foreground">
                    {f.exercise} · <span className="mono-number">{f.load ?? "—"}lb × {f.reps ?? "—"}</span>
                    {f.velocity != null && <span> · {f.velocity.toFixed(2)}m/s</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

function Avatar({ athlete, name, size = "md" }: { athlete: Athlete | null; name: string; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  if (athlete?.photo_url) {
    return <img src={athlete.photo_url} alt="" className={cn("shrink-0 rounded-full object-cover", dim)} />;
  }
  return (
    <div className={cn("grid shrink-0 place-items-center rounded-full bg-secondary font-bold text-secondary-foreground", dim)}>
      {initials(name)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard panel (preserved)
// ---------------------------------------------------------------------------

function BoardPanel({
  title, icon = false, rows, unit, metricLabel, teamLabel, sport, range,
}: {
  title: string; icon?: boolean;
  rows: { athlete: Athlete; value: number; date: string; pct: number; isPR: boolean; recentPR: boolean }[];
  unit: string; metricLabel?: string; teamLabel: string; sport: string; range: RangeKind;
}) {
  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            {icon && <Trophy className="h-4 w-4 text-primary" />}
            {title}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {rows.length} ranked · {teamLabel}{sport !== "all" ? ` · ${sport}` : ""} · {RANGE_LABELS[range]}
          </span>
        </div>
        {metricLabel && icon && <div className="text-xs text-muted-foreground">{metricLabel}</div>}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {range === "today" ? "No results logged today yet for this metric." : "No qualifying results for this filter."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 w-12">Rank</th>
                  <th className="px-2 py-2">Athlete</th>
                  <th className="px-2 py-2">Best Result</th>
                  <th className="px-2 py-2 hidden md:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((r, i) => {
                  const tone = r.isPR ? "pr" : r.pct >= 95 ? "warn" : "bad";
                  const bg = r.recentPR ? "bg-[color:var(--lb-pr-bg)] animate-pulse-slow" : "";
                  return (
                    <tr key={r.athlete.id} className={cn("border-b last:border-0 transition-colors duration-150 hover:bg-muted/40", bg)}>
                      <td className="px-2 py-3 font-mono">
                        {i === 0 ? (
                          <span className="inline-flex items-center gap-1 text-[color:var(--lb-pr)]">
                            <Crown className="h-4 w-4 fill-current" />1
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{i + 1}</span>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <Link to="/athletes/$id" params={{ id: r.athlete.id }} className="font-medium hover:underline">
                          {athleteDisplayName(r.athlete)}
                        </Link>
                      </td>
                      <td className="px-2 py-3">
                        <ResultBadge tone={tone} value={fmtValue(r.value, unit)} pct={r.pct} isPR={r.isPR} />
                      </td>
                      <td className="px-2 py-3 hidden md:table-cell text-muted-foreground">{fmtDate(r.date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResultBadge({ tone, value, pct, isPR }: { tone: "pr" | "warn" | "bad"; value: string; pct: number; isPR: boolean }) {
  const cls =
    tone === "pr" ? "bg-[color:var(--lb-pr)] text-white"
    : tone === "warn" ? "bg-[color:var(--lb-warn)] text-black"
    : "bg-[color:var(--lb-bad)] text-white";
  return (
    <div className={cn("inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-sm font-semibold", cls)}>
      <span>{value}</span>
      <span className="rounded bg-black/25 px-1.5 py-0.5 text-[10px] font-bold">
        {isPR ? "PR" : `${Math.min(100, pct).toFixed(0)}%`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today's Workout (preserved)
// ---------------------------------------------------------------------------

function TodaysWorkoutPanel({ teamId, athletes, teams }: { teamId: string; athletes: Athlete[]; teams: Team[] }) {
  const { data: assignments = [] } = useQuery(workoutAssignmentsQO);
  const { data: workouts = [] } = useQuery(workoutsQO);
  const { data: blocks = [] } = useQuery(workoutBlocksQO);
  const { data: wExercises = [] } = useQuery(workoutExercisesQO);
  const { data: wSets = [] } = useQuery(workoutSetsQO);
  const { data: repMaxes = [] } = useQuery(repMaxesQO);

  const today = localDateKey();
  const [gender, setGender] = useState<string>("all");

  const teamAthletes = useMemo(
    () => athletes
      .filter((a) => teamId !== "all" && a.team_id === teamId)
      .filter((a) => gender === "all" || (a.gender ?? null) === gender)
      .sort((a, b) => athleteDisplayName(a).localeCompare(athleteDisplayName(b))),
    [athletes, teamId, gender],
  );

  const todaysWorkouts = useMemo(() => {
    if (teamId === "all") return [];
    const teamAthleteIds = new Set(athletes.filter((a) => a.team_id === teamId).map((a) => a.id));
    const wIds = new Set(
      assignments
        .filter((a) => a.scheduled_date === today && (a.team_id === teamId || (a.athlete_id && teamAthleteIds.has(a.athlete_id))))
        .map((a) => a.workout_id),
    );
    return workouts.filter((w) => wIds.has(w.id));
  }, [assignments, workouts, teamId, today, athletes]);

  const [workoutId, setWorkoutId] = useState<string>("");
  const [currentIdx, setCurrentIdx] = useState(0);

  useEffect(() => {
    if (workoutId && todaysWorkouts.some((w) => w.id === workoutId)) return;
    setWorkoutId(todaysWorkouts[0]?.id ?? "");
    setCurrentIdx(0);
  }, [todaysWorkouts, workoutId]);

  useEffect(() => { setCurrentIdx(0); }, [workoutId]);

  const orderedExercises = useMemo(() => {
    if (!workoutId) return [] as WorkoutExercise[];
    const wBlocks = blocks.filter((b) => b.workout_id === workoutId).sort((a, b) => a.position - b.position);
    const blockOrder = new Map(wBlocks.map((b, i) => [b.id, i]));
    return wExercises
      .filter((e) => e.workout_id === workoutId)
      .sort((a, b) => {
        const ba = a.block_id ? blockOrder.get(a.block_id) ?? 999 : 999;
        const bb = b.block_id ? blockOrder.get(b.block_id) ?? 999 : 999;
        return ba - bb || a.position - b.position;
      });
  }, [workoutId, blocks, wExercises]);

  const currentExercise = orderedExercises[currentIdx] ?? null;
  const currentSets = useMemo(() => {
    if (!currentExercise) return [] as WorkoutSet[];
    return wSets
      .filter((s) => s.workout_exercise_id === currentExercise.id)
      .sort((a, b) => a.position - b.position);
  }, [wSets, currentExercise]);

  const displaySets = useMemo<Array<Pick<WorkoutSet, "position" | "load" | "percent" | "percent_of_exercise_id" | "rm_reps"> & { reps: string | null }>>(() => {
    if (!currentExercise) return [];
    if (currentSets.length > 0) return currentSets.map((s) => ({ ...s, reps: s.reps }));
    const n = Math.max(1, currentExercise.sets ?? 1);
    return Array.from({ length: n }, (_, i) => ({
      position: i + 1,
      load: currentExercise.load ?? null,
      percent: currentExercise.percent ?? null,
      percent_of_exercise_id: currentExercise.percent_of_exercise_id ?? null,
      rm_reps: null,
      reps: currentExercise.reps ?? null,
    }));
  }, [currentSets, currentExercise]);

  const prescribedLabel = (s: typeof displaySets[number]) => {
    if (s.load != null) return `${s.load} lb`;
    if (s.percent != null) return `${s.percent}% 1RM`;
    if (s.rm_reps != null) return `@${s.rm_reps}RM`;
    if (currentExercise?.load != null) return `${currentExercise.load} lb`;
    if (currentExercise?.percent != null) return `${currentExercise.percent}% 1RM`;
    return "BW";
  };

  const weightFor = (athleteId: string, s: typeof displaySets[number]): string => {
    if (!currentExercise) return "—";
    if (s.load != null) return `${s.load} lb`;
    const suggestion = suggestLoad({
      athleteId,
      exercise: currentExercise,
      setRow: s as WorkoutSet,
      repMaxes,
    });
    if (suggestion) return `${suggestion.load} lb`;
    if (currentExercise.load != null) return `${currentExercise.load} lb`;
    return "—";
  };

  const teamName = teams.find((t) => t.id === teamId)?.name;

  if (teamId === "all") {
    return (
      <Card className="card-elevated">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Dumbbell className="h-4 w-4" /> Today's Workout</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Select a team in the filters above to load today's prescription and per-athlete weights.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Dumbbell className="h-4 w-4" /> Today's Workout
            {teamName && <span className="text-xs font-normal text-muted-foreground">· {teamName}</span>}
          </CardTitle>
          {orderedExercises.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Exercise {currentIdx + 1} of {orderedExercises.length}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Workout</Label>
            <Select value={workoutId} onValueChange={setWorkoutId}>
              <SelectTrigger><SelectValue placeholder={todaysWorkouts.length ? "Pick today's workout…" : "No workout assigned today"} /></SelectTrigger>
              <SelectContent>
                {todaysWorkouts.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Gender</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All genders</SelectItem>
                {GENDERS.map((g) => <SelectItem key={g} value={g}>{GENDER_LABELS[g]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!workoutId ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {todaysWorkouts.length === 0 ? "No workout scheduled for this team today." : "Pick a workout to begin."}
          </div>
        ) : !currentExercise ? (
          <div className="py-8 text-center text-sm text-muted-foreground">This workout has no exercises.</div>
        ) : (
          <div className="rounded-lg border bg-card">
            <div className="flex items-center justify-between gap-3 border-b p-3">
              <div className="min-w-0">
                <div className="text-lg font-semibold truncate">{currentExercise.exercise_name}</div>
                {currentExercise.notes && <div className="text-xs text-muted-foreground mt-0.5 truncate">{currentExercise.notes}</div>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button size="sm" variant="outline" onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))} disabled={currentIdx === 0}>
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <Button size="sm" onClick={() => setCurrentIdx((i) => Math.min(orderedExercises.length - 1, i + 1))} disabled={currentIdx >= orderedExercises.length - 1}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="border-b p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Team prescription</div>
              <div className="flex flex-wrap gap-2">
                {displaySets.map((s) => (
                  <div key={s.position} className="rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs">
                    <span className="font-mono text-muted-foreground">Set {s.position}</span>
                    <span className="mx-1.5">·</span>
                    <span>{s.reps ?? currentExercise.reps ?? "—"} reps</span>
                    <span className="mx-1.5">·</span>
                    <span className="font-semibold">{prescribedLabel(s)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto p-3">
              {teamAthletes.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">No athletes match this team/gender filter.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3">Athlete</th>
                      {displaySets.map((s) => (
                        <th key={s.position} className="py-2 px-2 text-right whitespace-nowrap">
                          Set {s.position}
                          <div className="text-[10px] font-normal normal-case text-muted-foreground/70">
                            {s.reps ?? currentExercise.reps ?? "—"}×
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {teamAthletes.map((a) => (
                      <tr key={a.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="py-2 pr-3">
                          <Link to="/athletes/$id" params={{ id: a.id }} className="font-medium hover:underline">
                            {athleteDisplayName(a)}
                          </Link>
                        </td>
                        {displaySets.map((s) => (
                          <td key={s.position} className="py-2 px-2 text-right font-semibold whitespace-nowrap">
                            {weightFor(a.id, s)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="mt-2 text-xs text-muted-foreground">
                Percent- and RM-based sets resolve to each athlete's exact weight using their best e1RM. Dash means no rep max on file yet.
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
