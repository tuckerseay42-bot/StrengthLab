import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  leaderboardsQO, customMetricsQO, athletesQO, testsQO, liftsQO, attendanceQO, teamsQO, testTypesQO,
  athleteTeamsQO,
  athleteDisplayName, type Leaderboard, type CustomMetric,
  type LiftRow, type AttendanceRow, type CustomTestType, type AthleteTeam,
} from "@/lib/queries";
import { SPORTS, GRADES, GENDERS, GENDER_LABELS, downloadCSV } from "@/lib/domain";
import { computeMetric } from "@/lib/metrics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Trophy, Download, Pencil } from "lucide-react";
import { toast } from "sonner";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";

export const Route = createFileRoute("/leaderboards")({
  head: () => ({ meta: [{ title: "Leaderboards — Strength Lab" }] }),
  component: LeaderboardsPage,
});

type RangeKind = "all" | "today" | "week" | "month" | "3month" | "custom";
type FormState = {
  name: string; metric_id: string; team_id: string;
  sport: string; grade: string; position: string; gender: string; row_limit: string;
  range: RangeKind; date_from: string; date_to: string;
};
const EMPTY: FormState = {
  name: "", metric_id: "", team_id: "", sport: "", grade: "", position: "", gender: "", row_limit: "10",
  range: "all", date_from: "", date_to: "",
};

const RANGE_LABELS: Record<RangeKind, string> = {
  all: "All time", today: "Today", week: "Last 7 days",
  month: "Last 30 days", "3month": "Last 90 days", custom: "Custom range",
};

function rangeToWindow(f: { range: RangeKind; date_from: string; date_to: string }): { since_days: number | null; date_from: string | null; date_to: string | null } {
  if (f.range === "all") return { since_days: null, date_from: null, date_to: null };
  if (f.range === "today") return { since_days: 1, date_from: null, date_to: null };
  if (f.range === "week") return { since_days: 7, date_from: null, date_to: null };
  if (f.range === "month") return { since_days: 30, date_from: null, date_to: null };
  if (f.range === "3month") return { since_days: 90, date_from: null, date_to: null };
  return { since_days: null, date_from: f.date_from || null, date_to: f.date_to || null };
}

function boardToWindow(b: Leaderboard): { from: string | null; to: string | null } {
  if (b.since_days) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - b.since_days);
    return { from: cutoff.toISOString().slice(0, 10), to: null };
  }
  return { from: b.date_from, to: b.date_to };
}

function boardRangeLabel(b: Leaderboard): string {
  if (b.since_days === 1) return "Today";
  if (b.since_days === 7) return "Last 7d";
  if (b.since_days === 30) return "Last 30d";
  if (b.since_days === 90) return "Last 90d";
  if (b.since_days) return `Last ${b.since_days}d`;
  if (b.date_from || b.date_to) return `${b.date_from ?? "…"} → ${b.date_to ?? "…"}`;
  return "All time";
}

function formatLeaderValue(v: number, unit: string | null | undefined): string {
  if (unit === "reps") return String(Math.round(v));
  if (unit === "lb") return String(Math.round(v / 5) * 5);
  return v.toFixed(2);
}


function LeaderboardsPage() {
  const qc = useQueryClient();
  const { data: boards = [] } = useQuery(leaderboardsQO);
  const { data: metrics = [] } = useQuery(customMetricsQO);
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: tests = [] } = useQuery(testsQO);
  const { data: lifts = [] } = useQuery(liftsQO);
  const { data: attendance = [] } = useQuery(attendanceQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const { data: athleteTeams = [] } = useQuery(athleteTeamsQO);

  const teamsByAthlete = useMemo(() => {
    const m = new Map<string, Set<string>>();
    (athleteTeams as AthleteTeam[]).forEach((r) => {
      if (!m.has(r.athlete_id)) m.set(r.athlete_id, new Set());
      m.get(r.athlete_id)!.add(r.team_id);
    });
    return m;
  }, [athleteTeams]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Leaderboard | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  const metricById = useMemo(() => new Map(metrics.map((m) => [m.id, m])), [metrics]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      if (!form.metric_id) throw new Error("Pick a metric");
      const win = rangeToWindow(form);
      const payload = {
        name: form.name.trim(),
        metric_id: form.metric_id,
        team_id: form.team_id || null,
        sport: form.sport || null,
        grade: form.grade ? Number(form.grade) : null,
        position: form.position.trim() || null,
        gender: form.gender || null,
        row_limit: Math.max(1, Math.min(200, Number(form.row_limit) || 10)),
        since_days: win.since_days,
        date_from: win.date_from,
        date_to: win.date_to,
      };
      if (editing) {
        const { error } = await supabase.from("leaderboards").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const organization_id = await getScopedOrgId();
        const { error } = await supabase.from("leaderboards").insert({ ...payload, organization_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leaderboards"] });
      toast.success(editing ? "Leaderboard updated" : "Leaderboard added");
      setOpen(false); setEditing(null); setForm(EMPTY);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leaderboards").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["leaderboards"] }); toast.success("Removed"); },
  });

  const openEdit = (b: Leaderboard) => {
    setEditing(b);
    const range: RangeKind = b.since_days === 1 ? "today"
      : b.since_days === 7 ? "week"
      : b.since_days === 30 ? "month"
      : b.since_days === 90 ? "3month"
      : (b.date_from || b.date_to) ? "custom" : "all";
    setForm({
      name: b.name, metric_id: b.metric_id, team_id: b.team_id ?? "",
      sport: b.sport ?? "", grade: b.grade != null ? String(b.grade) : "",
      position: b.position ?? "", gender: b.gender ?? "", row_limit: String(b.row_limit),
      range, date_from: b.date_from ?? "", date_to: b.date_to ?? "",
    });
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Leaderboards</h1>
          <p className="text-sm text-muted-foreground">{boards.length} saved · updated live from athlete data</p>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setForm(EMPTY); setOpen(true); }} disabled={metrics.length === 0}>
          <Plus className="h-4 w-4" /> New leaderboard
        </Button>
      </div>

      {metrics.length === 0 && (
        <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
          Create a <Link to="/metrics" className="text-primary underline">custom metric</Link> first.
        </CardContent></Card>
      )}

      {boards.length === 0 && metrics.length > 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No leaderboards yet. Create one to rank athletes by any metric with team, sport, grade, or position filters.
        </CardContent></Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {boards.map((b) => {
          const metric = metricById.get(b.metric_id);
          return (
            <BoardCard
              key={b.id} board={b} metric={metric}
              teamName={b.team_id ? teamById.get(b.team_id)?.name : undefined}
              athletes={athletes} tests={tests} lifts={lifts} attendance={attendance}
              customTypes={customTypes}
              teamsByAthlete={teamsByAthlete}
              onEdit={() => openEdit(b)}
              onDelete={() => { if (confirm(`Delete ${b.name}?`)) del.mutate(b.id); }}
            />
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit leaderboard" : "New leaderboard"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Varsity Football — Relative Squat" /></div>
            <div>
              <Label>Metric *</Label>
              <Select value={form.metric_id} onValueChange={(v) => setForm({ ...form, metric_id: v })}>
                <SelectTrigger><SelectValue placeholder="Choose metric…" /></SelectTrigger>
                <SelectContent>
                  {metrics.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Team</Label>
                <Select value={form.team_id || "any"} onValueChange={(v) => setForm({ ...form, team_id: v === "any" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any team</SelectItem>
                    {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Sport</Label>
                <Select value={form.sport || "any"} onValueChange={(v) => setForm({ ...form, sport: v === "any" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any sport</SelectItem>
                    {SPORTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Grade</Label>
                <Select value={form.grade || "any"} onValueChange={(v) => setForm({ ...form, grade: v === "any" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any grade</SelectItem>
                    {GRADES.map((g) => <SelectItem key={g} value={String(g)}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Position</Label><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="Optional" /></div>
              <div>
                <Label>Gender</Label>
                <Select value={form.gender || "any"} onValueChange={(v) => setForm({ ...form, gender: v === "any" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any gender</SelectItem>
                    {GENDERS.map((g) => <SelectItem key={g} value={g}>{GENDER_LABELS[g]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date range</Label>
                <Select value={form.range} onValueChange={(v) => setForm({ ...form, range: v as RangeKind })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RANGE_LABELS) as RangeKind[]).map((k) => (
                      <SelectItem key={k} value={k}>{RANGE_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Show top</Label><Input type="number" min={1} max={200} value={form.row_limit} onChange={(e) => setForm({ ...form, row_limit: e.target.value })} /></div>
            </div>
            {form.range === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>From</Label><Input type="date" value={form.date_from} onChange={(e) => setForm({ ...form, date_from: e.target.value })} /></div>
                <div><Label>To</Label><Input type="date" value={form.date_to} onChange={(e) => setForm({ ...form, date_to: e.target.value })} /></div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{editing ? "Save" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BoardCard({
  board, metric, teamName, athletes, tests, lifts, attendance, customTypes, teamsByAthlete, onEdit, onDelete,
}: {
  board: Leaderboard;
  metric: CustomMetric | undefined;
  teamName: string | undefined;
  athletes: any[];
  tests: any[];
  lifts: LiftRow[];
  attendance: AttendanceRow[];
  customTypes: CustomTestType[];
  teamsByAthlete: Map<string, Set<string>>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const rows = useMemo(() => {
    if (!metric) return [];
    const filtered = (athletes as any[]).filter((a) => {
      if (board.team_id) {
        const extras = teamsByAthlete.get(a.id);
        const belongs = a.team_id === board.team_id || (extras?.has(board.team_id) ?? false);
        if (!belongs) return false;
      }
      if (board.sport) {
        const sports = [a.sport, a.sport_fall, a.sport_winter, a.sport_spring].filter(Boolean);
        if (!sports.includes(board.sport)) return false;
      }
      if (board.grade != null && a.grade !== board.grade) return false;
      if (board.position && (a.position ?? "").toLowerCase() !== board.position.toLowerCase()) return false;
      if (board.gender && a.gender !== board.gender) return false;
      return true;
    });
    const w = boardToWindow(board);
    return computeMetric(metric, filtered, tests, lifts, attendance, w, customTypes).slice(0, board.row_limit);
  }, [board, metric, athletes, tests, lifts, attendance, customTypes, teamsByAthlete]);

  const filterBadges = [
    boardRangeLabel(board),
    teamName && `Team: ${teamName}`,
    board.sport && `Sport: ${board.sport}`,
    board.grade != null && `Grade ${board.grade}`,
    board.position && `Pos: ${board.position}`,
    board.gender && `Gender: ${board.gender}`,
  ].filter(Boolean) as string[];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 gap-2">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-4 w-4 text-primary" />{board.name}
          </CardTitle>
          <div className="mt-1 text-xs text-muted-foreground">
            {metric ? metric.name : <span className="text-destructive">Metric deleted</span>}
          </div>
          {filterBadges.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {filterBadges.map((b) => <Badge key={b} variant="outline" className="text-[10px]">{b}</Badge>)}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="icon" variant="ghost" onClick={() => downloadCSV(
            `${board.name}.csv`,
            rows.map((r, i) => ({ rank: i + 1, athlete: athleteDisplayName(r.athlete), value: r.value, breakdown: r.breakdown ?? "", date: r.date })),
          )}><Download className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4 text-destructive" /></Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No qualifying athletes yet.</p>
        ) : (
          <ol className="space-y-1">
            {rows.map((r, i) => (
              <li key={r.athlete.id} className="flex items-center justify-between gap-2 rounded border px-3 py-1.5 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-6 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                  <Link to="/athletes/$id" params={{ id: r.athlete.id }} className="truncate font-medium hover:underline">
                    {athleteDisplayName(r.athlete)}
                  </Link>
                  {r.athlete.grade && <Badge variant="outline" className="text-[10px]">G{r.athlete.grade}</Badge>}
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm">
                    {formatLeaderValue(r.value, metric?.unit)}{metric?.unit ? ` ${metric.unit}` : ""}
                  </div>
                  {r.breakdown && <div className="text-[10px] text-muted-foreground">{r.breakdown}</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
