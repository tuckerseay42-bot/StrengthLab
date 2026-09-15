import { createFileRoute } from "@tanstack/react-router";
import { estimate1RMRounded } from "@/lib/one-rm";
import { getOrg1RMFormula } from "@/hooks/use-1rm-formula";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  athletesQO, teamsQO, workoutsQO, workoutExercisesQO,
  athleteDisplayName, type Athlete,
} from "@/lib/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { SPORTS } from "@/lib/domain";
import { useActiveTeamId } from "@/hooks/use-active-team";

export const Route = createFileRoute("/log-review")({
  head: () => ({ meta: [
    { title: "Daily Training Log Review — Strength Lab" },
    { name: "description", content: "Review athlete-logged sets, catch outliers, and approve or reject flagged entries." },
  ] }),
  component: LogReview,
});

type LogRow = {
  id: string;
  rack_session_id: string;
  athlete_id: string;
  workout_exercise_id: string;
  set_position: number;
  load: number | null;
  reps: number | null;
  time_seconds: number | null;
  distance_in: number | null;
  prescribed_load: number | null;
  prescribed_reps: number | null;
  estimated_1rm: number | null;
  status: string;
  completed_at: string;
  notes: string | null;
  validation_status: string;
  approval_status: string;
  review_note: string | null;
  review_reason: string | null;
};

type RangeMode = "day" | "week" | "month";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d: Date) { const x = new Date(d); const day = x.getDay(); x.setDate(x.getDate() - day); return x; }
function startOfMonth(d: Date) { const x = new Date(d); x.setDate(1); return x; }
function endOfMonth(d: Date) { const x = new Date(d); x.setMonth(x.getMonth() + 1); x.setDate(0); return x; }

function e1rm(load: number | null, reps: number | null): number | null {
  return estimate1RMRounded(load, reps, getOrg1RMFormula());
}

// Ranking mode for "best set" collapse in the log review.
type BestMode = "load" | "time" | "height";
function bestMode(row: LogRow): BestMode {
  if (row.time_seconds != null) return "time";
  if (row.distance_in != null) return "height";
  return "load";
}
function bestScore(row: LogRow): number | null {
  const m = bestMode(row);
  if (m === "time") return row.time_seconds;
  if (m === "height") return row.distance_in;
  return row.estimated_1rm ?? e1rm(row.load, row.reps);
}

function LogReview() {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: workouts = [] } = useQuery(workoutsQO);
  const { data: workoutExercises = [] } = useQuery(workoutExercisesQO);

  const [rangeMode, setRangeMode] = useState<RangeMode>("day");
  const [anchor, setAnchor] = useState<string>(today());

  const { from, to } = useMemo(() => {
    const d = new Date(anchor + "T00:00:00");
    if (rangeMode === "day") return { from: iso(d), to: iso(d) };
    if (rangeMode === "week") { const s = startOfWeek(d); return { from: iso(s), to: iso(addDays(s, 6)) }; }
    return { from: iso(startOfMonth(d)), to: iso(endOfMonth(d)) };
  }, [anchor, rangeMode]);

  const [activeTeamId] = useActiveTeamId();
  const [f, setF] = useState({
    team: activeTeamId ?? "all", sport: "all", group: "all",
    athlete: "all", exercise: "all", liftType: "all",
    coach: "all", statusFilter: "all",
  });
  useEffect(() => {
    setF((prev) => ({ ...prev, team: activeTeamId ?? "all" }));
  }, [activeTeamId]);

  // Sessions + logs for range
  const sessionsQ = useQuery({
    queryKey: ["log-review-sessions", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rack_sessions")
        .select("id, team_id, session_date, workout_id, rack_number")
        .gte("session_date", from).lte("session_date", to);
      if (error) throw error;
      return data ?? [];
    },
  });
  const sessions = sessionsQ.data ?? [];
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);

  const logsQ = useQuery({
    queryKey: ["log-review-logs", sessionIds.join(",")],
    enabled: sessionIds.length > 0,
    queryFn: async (): Promise<LogRow[]> => {
      const { data, error } = await supabase
        .from("rack_set_logs")
        .select("id, rack_session_id, athlete_id, workout_exercise_id, set_position, load, reps, time_seconds, distance_in, prescribed_load, prescribed_reps, estimated_1rm, status, completed_at, notes, validation_status, approval_status, review_note, review_reason")
        .in("rack_session_id", sessionIds)
        .order("completed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LogRow[];
    },
  });
  const logs = logsQ.data ?? [];

  // Baselines: recent history per (athlete, exercise) — best e1RM over past 60 days
  const baselineQ = useQuery({
    queryKey: ["log-review-baselines", from],
    queryFn: async () => {
      const fromDate = iso(addDays(new Date(from + "T00:00:00"), -60));
      const { data, error } = await supabase
        .from("rack_set_logs")
        .select("athlete_id, workout_exercise_id, load, reps, completed_at, approval_status")
        .gte("completed_at", fromDate + "T00:00:00")
        .lte("completed_at", from + "T23:59:59")
        .in("approval_status", ["auto", "approved"]);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const r of (data ?? []) as { athlete_id: string; workout_exercise_id: string; load: number | null; reps: number | null }[]) {
        const key = `${r.athlete_id}:${r.workout_exercise_id}`;
        const est = e1rm(r.load, r.reps);
        if (est == null) continue;
        const prev = map.get(key) ?? 0;
        if (est > prev) map.set(key, est);
      }
      return map;
    },
  });
  const baselines = baselineQ.data ?? new Map<string, number>();

  const athleteMap = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes]);
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const exMap = useMemo(() => new Map(workoutExercises.map((e) => [e.id, e])), [workoutExercises]);
  const workoutMap = useMemo(() => new Map(workouts.map((w) => [w.id, w])), [workouts]);
  const sessionMap = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  const trainingGroups = useMemo(() => {
    const s = new Set<string>();
    for (const a of athletes) {
      const g = (a as unknown as { training_group?: string | null }).training_group;
      if (g) s.add(g);
    }
    return Array.from(s).sort();
  }, [athletes]);

  const exerciseNames = useMemo(() => {
    const s = new Set<string>();
    workoutExercises.forEach((e) => s.add(e.exercise_name));
    return Array.from(s).sort();
  }, [workoutExercises]);

  const coaches = useMemo(() => {
    const s = new Set<string>();
    for (const w of workouts as unknown as Array<{ created_by?: string | null }>) {
      if (w.created_by) s.add(w.created_by);
    }
    return Array.from(s);
  }, [workouts]);

  // Client-side auto-classification for rows still marked 'normal' — coach override always wins.
  // Thresholds (loose): ±30% yellow, ±60% red vs baseline e1RM.
  function classify(row: LogRow): "green" | "yellow" | "red" {
    if (row.validation_status === "review") return "yellow";
    if (row.validation_status === "flagged") return "red";
    const est = row.estimated_1rm ?? e1rm(row.load, row.reps);
    if (est == null) return "green";
    const key = `${row.athlete_id}:${row.workout_exercise_id}`;
    const base = baselines.get(key);
    // Rep sanity: 3× prescribed reps or more, or 0 reps at heavy load
    if (row.prescribed_reps && row.reps && row.reps >= row.prescribed_reps * 3) return "red";
    if (base && base > 0) {
      const delta = (est - base) / base;
      if (Math.abs(delta) >= 0.6) return "red";
      if (Math.abs(delta) >= 0.3) return "yellow";
    }
    // Load-vs-prescribed sanity
    if (row.prescribed_load && row.load) {
      const d = (row.load - row.prescribed_load) / row.prescribed_load;
      if (Math.abs(d) >= 0.6) return "red";
      if (Math.abs(d) >= 0.3) return "yellow";
    }
    return "green";
  }

  // Enriched, filtered rows
  const filtered = useMemo(() => {
    return logs
      .map((l) => {
        const athlete = athleteMap.get(l.athlete_id);
        const ex = exMap.get(l.workout_exercise_id);
        const session = sessionMap.get(l.rack_session_id);
        const team = athlete?.team_id ? teamMap.get(athlete.team_id) : undefined;
        const workout = session?.workout_id ? workoutMap.get(session.workout_id) : undefined;
        const status = classify(l);
        const est = l.estimated_1rm ?? e1rm(l.load, l.reps);
        return { l, athlete, ex, session, team, workout, status, est };
      })
      .filter(({ l, athlete, ex, workout, status }) => {
        if (!athlete) return false;
        if (f.team !== "all" && athlete.team_id !== f.team) return false;
        if (f.sport !== "all" && athlete.sport !== f.sport) return false;
        if (f.group !== "all") {
          const g = (athlete as unknown as { training_group?: string | null }).training_group;
          if (g !== f.group) return false;
        }
        if (f.athlete !== "all" && athlete.id !== f.athlete) return false;
        if (f.exercise !== "all" && ex?.exercise_name !== f.exercise) return false;
        if (f.liftType !== "all" && l.status !== f.liftType) return false;
        if (f.coach !== "all") {
          const cb = (workout as unknown as { created_by?: string | null } | undefined)?.created_by;
          if (cb !== f.coach) return false;
        }
        if (f.statusFilter !== "all") {
          if (f.statusFilter === "pending" && l.approval_status !== "pending" && status !== "red" && status !== "yellow") return false;
          if (f.statusFilter === "approved" && l.approval_status !== "approved") return false;
          if (f.statusFilter === "rejected" && l.approval_status !== "rejected") return false;
          if (f.statusFilter === "green" && status !== "green") return false;
          if (f.statusFilter === "yellow" && status !== "yellow") return false;
          if (f.statusFilter === "red" && status !== "red") return false;
        }
        return true;
      });
  }, [logs, f, athleteMap, exMap, sessionMap, teamMap, workoutMap, baselines]);

  // Collapse to one row per athlete × exercise × day — the "best" set only.
  // Best = lowest time / highest jump-height / highest e1RM (load).
  const bestRows = useMemo(() => {
    const map = new Map<string, typeof filtered[number]>();
    for (const r of filtered) {
      const day = r.l.completed_at.slice(0, 10);
      const key = `${r.l.athlete_id}:${r.l.workout_exercise_id}:${day}`;
      const prev = map.get(key);
      if (!prev) { map.set(key, r); continue; }
      const mode = bestMode(r.l);
      const a = bestScore(r.l);
      const b = bestScore(prev.l);
      if (a == null) continue;
      if (b == null) { map.set(key, r); continue; }
      const rWins = mode === "time" ? a < b : a > b;
      if (rWins) map.set(key, r);
    }
    return Array.from(map.values()).sort(
      (x, y) => y.l.completed_at.localeCompare(x.l.completed_at),
    );
  }, [filtered]);

  const summary = useMemo(() => {
    let green = 0, yellow = 0, red = 0, approved = 0, rejected = 0;
    const ath = new Set<string>();
    for (const r of bestRows) {
      if (r.status === "green") green++;
      else if (r.status === "yellow") yellow++;
      else red++;
      if (r.l.approval_status === "approved") approved++;
      if (r.l.approval_status === "rejected") rejected++;
      ath.add(r.l.athlete_id);
    }
    return { total: bestRows.length, athletes: ath.size, green, yellow, red, approved, rejected };
  }, [bestRows]);

  // Auto-persist validation_status for rows that need it (silent background update)
  const syncValidation = useMutation({
    mutationFn: async (rows: Array<{ id: string; status: "yellow" | "red" }>) => {
      for (const r of rows) {
        await supabase
          .from("rack_set_logs")
          .update({
            validation_status: r.status === "red" ? "flagged" : "review",
            approval_status: "pending",
          })
          .eq("id", r.id).eq("validation_status", "normal");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["log-review-logs"] }),
  });

  // Coach actions
  const [dialog, setDialog] = useState<{ row: LogRow; action: "approve" | "reject" | "edit" | "note" } | null>(null);
  const [edit, setEdit] = useState({ load: "", reps: "", note: "", reason: "" });

  const act = useMutation({
    mutationFn: async ({ row, action, patch }: { row: LogRow; action: string; patch: Record<string, unknown> }) => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? null;
      const base: Record<string, unknown> = {
        reviewed_by: uid,
        reviewed_at: new Date().toISOString(),
        ...patch,
      };
      if (action === "approve") { base.approval_status = "approved"; base.validation_status = "normal"; }
      if (action === "reject") { base.approval_status = "rejected"; }
      if (action === "edit") { base.approval_status = "approved"; base.validation_status = "normal"; }
      const { error } = await supabase.from("rack_set_logs").update(base as never).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["log-review-logs"] });
      qc.invalidateQueries({ queryKey: ["rep_maxes"] });
      toast.success("Updated");
      setDialog(null);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  // Run background classification once per row set
  useEffect(() => {
    const pending = filtered
      .filter((r) => r.l.validation_status === "normal" && (r.status === "yellow" || r.status === "red"))
      .map((r) => ({ id: r.l.id, status: r.status as "yellow" | "red" }));
    if (pending.length > 0 && !syncValidation.isPending) syncValidation.mutate(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.length]);

  const statusBadge = (row: LogRow, status: "green" | "yellow" | "red") => {
    if (row.approval_status === "approved") return <Badge className="bg-emerald-600">Approved</Badge>;
    if (row.approval_status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
    if (status === "red") return <Badge variant="destructive">Red · needs approval</Badge>;
    if (status === "yellow") return <Badge className="bg-amber-500 text-white">Yellow · review</Badge>;
    return <Badge className="bg-emerald-600">Green · normal</Badge>;
  };

  const shiftAnchor = (n: number) => {
    const d = new Date(anchor + "T00:00:00");
    if (rangeMode === "day") setAnchor(iso(addDays(d, n)));
    else if (rangeMode === "week") setAnchor(iso(addDays(d, n * 7)));
    else { const nd = new Date(d); nd.setMonth(nd.getMonth() + n); setAnchor(iso(nd)); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Daily Training Log Review</h1>
        <p className="text-sm text-muted-foreground">
          Review athlete-logged sets. Green updates records automatically. Yellow needs a look. Red is held until you approve.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Sets logged" value={summary.total} />
        <Stat label="Athletes" value={summary.athletes} />
        <Stat label="Green" value={summary.green} tone="green" />
        <Stat label="Yellow" value={summary.yellow} tone="yellow" />
        <Stat label="Red" value={summary.red} tone="red" />
        <Stat label="Approved" value={summary.approved} />
        <Stat label="Rejected" value={summary.rejected} />
      </div>

      {/* Date range */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 p-3">
          <div className="flex items-center gap-1">
            {(["day", "week", "month"] as RangeMode[]).map((m) => (
              <Button key={m} size="sm" variant={rangeMode === m ? "default" : "outline"} onClick={() => setRangeMode(m)}>
                {m[0].toUpperCase() + m.slice(1)}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" onClick={() => shiftAnchor(-1)} aria-label="Previous">‹</Button>
            <Input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} className="w-40" />
            <Button size="icon" variant="outline" onClick={() => shiftAnchor(1)} aria-label="Next">›</Button>
            <Button size="sm" variant="ghost" onClick={() => setAnchor(today())}>Today</Button>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">{from} → {to}</div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 lg:grid-cols-8">
          <FilterSelect label="Team" value={f.team} onChange={(v) => setF({ ...f, team: v })}
            options={[{ v: "all", l: "All teams" }, ...teams.map((t) => ({ v: t.id, l: t.name }))]} />
          <FilterSelect label="Sport" value={f.sport} onChange={(v) => setF({ ...f, sport: v })}
            options={[{ v: "all", l: "All sports" }, ...SPORTS.map((s) => ({ v: s, l: s }))]} />
          <FilterSelect label="Group" value={f.group} onChange={(v) => setF({ ...f, group: v })}
            options={[{ v: "all", l: "All groups" }, ...trainingGroups.map((g) => ({ v: g, l: g }))]} />
          <FilterSelect label="Athlete" value={f.athlete} onChange={(v) => setF({ ...f, athlete: v })}
            options={[{ v: "all", l: "All athletes" }, ...athletes.map((a: Athlete) => ({ v: a.id, l: athleteDisplayName(a) }))]} />
          <FilterSelect label="Exercise" value={f.exercise} onChange={(v) => setF({ ...f, exercise: v })}
            options={[{ v: "all", l: "All exercises" }, ...exerciseNames.map((n) => ({ v: n, l: n }))]} />
          <FilterSelect label="Lift type" value={f.liftType} onChange={(v) => setF({ ...f, liftType: v })}
            options={[{ v: "all", l: "All" }, { v: "completed", l: "Completed" }, { v: "skipped", l: "Skipped" }]} />
          <FilterSelect label="Coach" value={f.coach} onChange={(v) => setF({ ...f, coach: v })}
            options={[{ v: "all", l: "All coaches" }, ...coaches.map((c) => ({ v: c, l: c.slice(0, 8) }))]} />
          <FilterSelect label="Status" value={f.statusFilter} onChange={(v) => setF({ ...f, statusFilter: v })}
            options={[
              { v: "all", l: "All statuses" },
              { v: "green", l: "Green" },
              { v: "yellow", l: "Yellow" },
              { v: "red", l: "Red" },
              { v: "pending", l: "Needs review" },
              { v: "approved", l: "Approved" },
              { v: "rejected", l: "Rejected" },
            ]} />
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Athlete</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Exercise</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Set</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">Reps</TableHead>
                <TableHead className="text-right">Prescribed</TableHead>
                <TableHead className="text-right">Δ</TableHead>
                <TableHead className="text-right">e1RM</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bestRows.length === 0 ? (
                <TableRow><TableCell colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
                  {logsQ.isLoading ? "Loading…" : "No logged sets in this range."}
                </TableCell></TableRow>
              ) : bestRows.map(({ l, athlete, ex, team, status, est }) => {
                const diff = l.prescribed_load && l.load ? l.load - l.prescribed_load : null;
                const tone = status === "red" ? "border-l-4 border-red-500"
                  : status === "yellow" ? "border-l-4 border-amber-500"
                  : "border-l-4 border-emerald-500";
                return (
                  <TableRow key={l.id} className={tone}>
                    <TableCell className="font-medium">{athlete ? athleteDisplayName(athlete) : "—"}</TableCell>
                    <TableCell className="text-xs">{team?.name ?? "—"}</TableCell>
                    <TableCell>{ex?.exercise_name ?? "—"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{l.completed_at.slice(0, 10)}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.set_position}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.time_seconds != null
                        ? `${Number(l.time_seconds).toFixed(3)}s`
                        : l.distance_in != null
                          ? `${Number(l.distance_in).toFixed(2)}in`
                          : (l.load ?? "—")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.reps ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {l.prescribed_load ?? "—"} × {l.prescribed_reps ?? "—"}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums text-xs ${diff && diff > 0 ? "text-emerald-600" : diff && diff < 0 ? "text-red-600" : ""}`}>
                      {diff == null ? "—" : diff > 0 ? `+${diff}` : diff}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{est == null ? "—" : Math.round(est / 5) * 5}</TableCell>
                    <TableCell>{statusBadge(l, status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => { setEdit({ load: String(l.load ?? ""), reps: String(l.reps ?? ""), note: l.review_note ?? "", reason: l.review_reason ?? "" }); setDialog({ row: l, action: "edit" }); }}>Edit</Button>
                        <Button size="sm" variant="outline" onClick={() => act.mutate({ row: l, action: "approve", patch: {} })}>Approve</Button>
                        <Button size="sm" variant="destructive" onClick={() => { setEdit({ load: "", reps: "", note: "", reason: "data_entry_error" }); setDialog({ row: l, action: "reject" }); }}>Reject</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog for edit/reject */}
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.action === "edit" ? "Edit entry" : dialog?.action === "reject" ? "Reject entry" : "Add note"}
            </DialogTitle>
          </DialogHeader>
          {dialog?.action === "edit" && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Weight</Label><Input value={edit.load} onChange={(e) => setEdit({ ...edit, load: e.target.value })} /></div>
              <div><Label>Reps</Label><Input value={edit.reps} onChange={(e) => setEdit({ ...edit, reps: e.target.value })} /></div>
            </div>
          )}
          <div>
            <Label>Reason</Label>
            <Select value={edit.reason || "none"} onValueChange={(v) => setEdit({ ...edit, reason: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Choose reason" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="data_entry_error">Data entry error</SelectItem>
                <SelectItem value="legitimate_jump">Legitimate performance jump</SelectItem>
                <SelectItem value="wrong_exercise">Wrong exercise selected</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Note</Label>
            <Textarea rows={3} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            {dialog?.action === "edit" ? (
              <Button onClick={() => dialog && act.mutate({
                row: dialog.row, action: "edit",
                patch: {
                  load: edit.load === "" ? null : Number(edit.load),
                  reps: edit.reps === "" ? null : Number(edit.reps),
                  review_note: edit.note || null,
                  review_reason: edit.reason || null,
                },
              })}>Save & approve</Button>
            ) : (
              <Button variant="destructive" onClick={() => dialog && act.mutate({
                row: dialog.row, action: "reject",
                patch: { review_note: edit.note || null, review_reason: edit.reason || null },
              })}>Reject entry</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "green" | "yellow" | "red" }) {
  const color = tone === "green" ? "text-emerald-600" : tone === "yellow" ? "text-amber-600" : tone === "red" ? "text-red-600" : "";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
