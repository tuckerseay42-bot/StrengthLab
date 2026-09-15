import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { athletesQO, teamsQO, workoutAssignmentsQO, athleteDisplayName } from "@/lib/queries";
import { useActiveTeamId } from "@/hooks/use-active-team";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

export const Route = createFileRoute("/training/analytics")({
  head: () => ({ meta: [{ title: "Training — Analytics" }] }),
  component: AnalyticsView,
});

type ApprovedLog = {
  id: string;
  athlete_id: string;
  workout_exercise_id: string | null;
  set_position: number | null;
  load: number | null;
  reps: number | null;
  avg_velocity: number | null;
  estimated_1rm: number | null;
  completed_at: string | null;
  approval_status: string | null;
  status: string | null;
};

type WorkoutExerciseRow = { id: string; exercise_name: string | null };

const LINE_COLORS = ["var(--primary)", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

function fmtDate(d: Date) { return d.toISOString().slice(0, 10); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return fmtDate(d); }
function isoWeek(dateStr: string) {
  // Group by ISO week start (Mon)
  const d = new Date(dateStr);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function AnalyticsView() {
  const [dateFrom, setDateFrom] = useState(daysAgo(60));
  const [dateTo, setDateTo] = useState(fmtDate(new Date()));
  const [activeTeamId] = useActiveTeamId();
  const [teamId, setTeamId] = useState<string>(activeTeamId ?? "all");

  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: assignments = [] } = useQuery(workoutAssignmentsQO);

  const logsQ = useQuery({
    queryKey: ["analytics_rack_logs", dateFrom, dateTo],
    queryFn: async (): Promise<ApprovedLog[]> => {
      const { data, error } = await supabase
        .from("rack_set_logs")
        .select("id, athlete_id, workout_exercise_id, set_position, load, reps, avg_velocity, estimated_1rm, completed_at, approval_status, status")
        .in("approval_status", ["auto", "approved"])
        .eq("status", "completed")
        .gte("completed_at", `${dateFrom}T00:00:00`)
        .lte("completed_at", `${dateTo}T23:59:59`)
        .order("completed_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ApprovedLog[];
    },
    staleTime: 60_000,
  });

  const weIds = useMemo(
    () => Array.from(new Set((logsQ.data ?? []).map((l) => l.workout_exercise_id).filter(Boolean))) as string[],
    [logsQ.data],
  );

  const weQ = useQuery({
    queryKey: ["analytics_workout_exercises", weIds.join(",")],
    enabled: weIds.length > 0,
    queryFn: async (): Promise<WorkoutExerciseRow[]> => {
      const { data, error } = await supabase
        .from("workout_exercises")
        .select("id, exercise_name")
        .in("id", weIds);
      if (error) throw error;
      return (data ?? []) as WorkoutExerciseRow[];
    },
    staleTime: 5 * 60_000,
  });

  const exerciseName = useMemo(() => {
    const m = new Map<string, string>();
    (weQ.data ?? []).forEach((r) => m.set(r.id, r.exercise_name ?? "Exercise"));
    return m;
  }, [weQ.data]);

  // Filter athletes by team
  const teamAthleteIds = useMemo(() => {
    if (teamId === "all") return null;
    return new Set(athletes.filter((a) => a.team_id === teamId).map((a) => a.id));
  }, [athletes, teamId]);

  const scopedLogs = useMemo(() => {
    const all = logsQ.data ?? [];
    if (!teamAthleteIds) return all;
    return all.filter((l) => teamAthleteIds.has(l.athlete_id));
  }, [logsQ.data, teamAthleteIds]);

  const scopedAssignments = useMemo(() => {
    return assignments.filter((a) => {
      const d = a.scheduled_date;
      if (!d || d < dateFrom || d > dateTo) return false;
      if (teamAthleteIds && a.athlete_id && !teamAthleteIds.has(a.athlete_id)) return false;
      if (teamAthleteIds && !a.athlete_id && a.team_id && a.team_id !== teamId) return false;
      return true;
    });
  }, [assignments, dateFrom, dateTo, teamAthleteIds, teamId]);

  // ---------------- Metrics ----------------
  // Completion trend (by ISO week)
  const completionTrend = useMemo(() => {
    const byWeekAssigned = new Map<string, Set<string>>(); // week -> set of "athleteId:workoutId:date"
    const byWeekCompleted = new Map<string, Set<string>>();
    for (const a of scopedAssignments) {
      const w = isoWeek(a.scheduled_date);
      const key = `${a.athlete_id ?? a.team_id}:${a.workout_id}:${a.scheduled_date}`;
      if (!byWeekAssigned.has(w)) byWeekAssigned.set(w, new Set());
      byWeekAssigned.get(w)!.add(key);
    }
    // "Completed" = distinct athlete/day with any approved log
    const athleteDayCompleted = new Set<string>();
    for (const l of scopedLogs) {
      if (!l.completed_at) continue;
      const day = l.completed_at.slice(0, 10);
      athleteDayCompleted.add(`${l.athlete_id}:${day}`);
      const w = isoWeek(day);
      if (!byWeekCompleted.has(w)) byWeekCompleted.set(w, new Set());
      byWeekCompleted.get(w)!.add(`${l.athlete_id}:${day}`);
    }
    const weeks = Array.from(new Set([...byWeekAssigned.keys(), ...byWeekCompleted.keys()])).sort();
    return weeks.map((w) => ({
      week: w,
      Assigned: byWeekAssigned.get(w)?.size ?? 0,
      Completed: byWeekCompleted.get(w)?.size ?? 0,
    }));
  }, [scopedAssignments, scopedLogs]);

  // Volume by exercise (total load = sum(load * reps))
  const volumeByExercise = useMemo(() => {
    const m = new Map<string, { sets: number; reps: number; volume: number }>();
    for (const l of scopedLogs) {
      const name = (l.workout_exercise_id && exerciseName.get(l.workout_exercise_id)) || "Unknown";
      const entry = m.get(name) ?? { sets: 0, reps: 0, volume: 0 };
      entry.sets += 1;
      entry.reps += l.reps ?? 0;
      entry.volume += (l.load ?? 0) * (l.reps ?? 0);
      m.set(name, entry);
    }
    return Array.from(m.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 12);
  }, [scopedLogs, exerciseName]);

  // Velocity trend for exercises with velocity — average by week per top 4 exercises
  const velocityTrend = useMemo(() => {
    const withVel = scopedLogs.filter((l) => l.avg_velocity != null && l.workout_exercise_id);
    const totalsByEx = new Map<string, number>();
    for (const l of withVel) {
      const name = exerciseName.get(l.workout_exercise_id!) ?? "Unknown";
      totalsByEx.set(name, (totalsByEx.get(name) ?? 0) + 1);
    }
    const top = Array.from(totalsByEx.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n);
    const byWeek = new Map<string, Record<string, { sum: number; n: number }>>();
    for (const l of withVel) {
      const name = exerciseName.get(l.workout_exercise_id!) ?? "Unknown";
      if (!top.includes(name)) continue;
      const w = isoWeek((l.completed_at ?? "").slice(0, 10));
      if (!byWeek.has(w)) byWeek.set(w, {});
      const row = byWeek.get(w)!;
      row[name] = row[name] ?? { sum: 0, n: 0 };
      row[name].sum += l.avg_velocity!;
      row[name].n += 1;
    }
    const rows = Array.from(byWeek.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, row]) => {
        const out: Record<string, string | number> = { week };
        for (const name of top) {
          if (row[name]) out[name] = +(row[name].sum / row[name].n).toFixed(2);
        }
        return out;
      });
    return { rows, keys: top };
  }, [scopedLogs, exerciseName]);

  // PR frequency — new best estimated_1rm per athlete+exercise, count by week
  const prTrend = useMemo(() => {
    const running = new Map<string, number>(); // athlete:exercise -> best 1rm
    const byWeek = new Map<string, number>();
    // Iterate chronologically (logs already ordered ascending)
    for (const l of scopedLogs) {
      if (l.estimated_1rm == null || !l.workout_exercise_id || !l.completed_at) continue;
      const key = `${l.athlete_id}:${l.workout_exercise_id}`;
      const prev = running.get(key) ?? 0;
      if (l.estimated_1rm > prev) {
        running.set(key, l.estimated_1rm);
        if (prev > 0) {
          // Count only after initial baseline
          const w = isoWeek(l.completed_at.slice(0, 10));
          byWeek.set(w, (byWeek.get(w) ?? 0) + 1);
        }
      }
    }
    return Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([week, PRs]) => ({ week, PRs }));
  }, [scopedLogs]);

  // Compliance by athlete
  const complianceByAthlete = useMemo(() => {
    const assignedPerA = new Map<string, Set<string>>(); // athlete -> "date:workout"
    for (const a of scopedAssignments) {
      if (!a.athlete_id) continue;
      if (teamAthleteIds && !teamAthleteIds.has(a.athlete_id)) continue;
      if (!assignedPerA.has(a.athlete_id)) assignedPerA.set(a.athlete_id, new Set());
      assignedPerA.get(a.athlete_id)!.add(`${a.scheduled_date}:${a.workout_id}`);
    }
    const completedPerA = new Map<string, Set<string>>();
    for (const l of scopedLogs) {
      if (!l.completed_at) continue;
      const day = l.completed_at.slice(0, 10);
      if (!completedPerA.has(l.athlete_id)) completedPerA.set(l.athlete_id, new Set());
      completedPerA.get(l.athlete_id)!.add(day);
    }
    const rows: { name: string; assigned: number; completed: number; pct: number }[] = [];
    const scope = teamAthleteIds ? athletes.filter((a) => teamAthleteIds.has(a.id)) : athletes;
    for (const a of scope) {
      const assigned = assignedPerA.get(a.id)?.size ?? 0;
      if (assigned === 0) continue;
      const done = completedPerA.get(a.id) ?? new Set();
      const completed = Array.from(assignedPerA.get(a.id) ?? []).filter((k) => done.has(k.split(":")[0])).length;
      rows.push({
        name: athleteDisplayName(a),
        assigned,
        completed,
        pct: Math.round((completed / assigned) * 100),
      });
    }
    return rows.sort((a, b) => b.pct - a.pct);
  }, [scopedAssignments, scopedLogs, athletes, teamAthleteIds]);

  const totalCompletion = useMemo(() => {
    const a = completionTrend.reduce((s, r) => s + r.Assigned, 0);
    const c = completionTrend.reduce((s, r) => s + r.Completed, 0);
    return { assigned: a, completed: c, pct: a ? Math.round((c / a) * 100) : 0 };
  }, [completionTrend]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Team</Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <StatPill label="Sets logged" value={scopedLogs.length.toLocaleString()} />
            <StatPill label="Athletes active" value={new Set(scopedLogs.map((l) => l.athlete_id)).size.toLocaleString()} />
            <StatPill label="Compliance" value={`${totalCompletion.pct}%`} tone={totalCompletion.pct >= 80 ? "good" : totalCompletion.pct >= 60 ? "warn" : "bad"} />
            <StatPill label="PRs" value={prTrend.reduce((s, r) => s + r.PRs, 0).toLocaleString()} tone="good" />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="completion" className="space-y-4">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="completion">Completion</TabsTrigger>
          <TabsTrigger value="volume">Volume</TabsTrigger>
          <TabsTrigger value="velocity">Velocity</TabsTrigger>
          <TabsTrigger value="prs">PR Frequency</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="completion">
          <ChartCard
            title="Assigned vs completed workouts"
            hint="Weekly count of scheduled workouts and how many were completed (approved logs)."
          >
            {completionTrend.length > 1 ? (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={completionTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="Assigned" stroke="#94a3b8" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Completed" stroke="var(--primary)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty />}
          </ChartCard>
        </TabsContent>

        <TabsContent value="volume">
          <ChartCard
            title="Volume by exercise"
            hint="Total weight moved (load × reps) across all approved sets in range. Top 12 shown."
          >
            {volumeByExercise.length ? (
              <ResponsiveContainer width="100%" height={Math.max(320, volumeByExercise.length * 28)}>
                <BarChart data={volumeByExercise} layout="vertical" margin={{ left: 90 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={150} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
                  <Bar dataKey="volume" fill="var(--primary)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty />}
          </ChartCard>
        </TabsContent>

        <TabsContent value="velocity">
          <ChartCard
            title="Average bar velocity trend"
            hint="Weekly average velocity for the top 4 exercises with velocity tracked."
          >
            {velocityTrend.rows.length > 1 && velocityTrend.keys.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={velocityTrend.rows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} unit=" m/s" />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {velocityTrend.keys.map((k, i) => (
                    <Line key={k} type="monotone" dataKey={k} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty message="No velocity data in this range." />}
          </ChartCard>
        </TabsContent>

        <TabsContent value="prs">
          <ChartCard
            title="New PRs per week"
            hint="Count of new estimated 1RM highs across athletes and exercises."
          >
            {prTrend.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={prTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
                  <Bar dataKey="PRs" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty message="No PRs recorded in this range." />}
          </ChartCard>
        </TabsContent>

        <TabsContent value="compliance">
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-border/60 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Compliance by athlete
                </div>
                <div className="text-xs text-muted-foreground">
                  Completed / assigned in range
                </div>
              </div>
              {complianceByAthlete.length ? (
                <div className="max-h-[520px] divide-y divide-border/40 overflow-auto">
                  {complianceByAthlete.map((r) => (
                    <div key={r.name} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <div className="min-w-[180px] truncate font-medium">{r.name}</div>
                      <div className="relative h-2 flex-1 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${r.pct}%`,
                            background:
                              r.pct >= 80 ? "#10b981" : r.pct >= 60 ? "#f59e0b" : "#ef4444",
                          }}
                        />
                      </div>
                      <div className="w-16 text-right tabular-nums text-xs text-muted-foreground">
                        {r.completed}/{r.assigned}
                      </div>
                      <Badge variant="secondary" className="w-12 justify-center tabular-nums">
                        {r.pct}%
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No assignments in this range.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ChartCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
          {hint && <div className="text-[11px] text-muted-foreground/70">{hint}</div>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Empty({ message = "Not enough data in this range." }: { message?: string }) {
  return <div className="grid h-[320px] place-items-center text-sm text-muted-foreground">{message}</div>;
}

function StatPill({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const toneCls =
    tone === "good" ? "text-emerald-500" :
    tone === "warn" ? "text-amber-500" :
    tone === "bad" ? "text-rose-500" : "text-foreground";
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}
