import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { athletesQO, testsQO, testAssignmentsQO, teamsQO, testTypesQO, customMetricsQO, athleteTeamsQO, type CustomMetric, type CustomTestType } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrgId } from "@/hooks/use-current-org";
import { Filters, emptyFilters, filterAthletes, inDateRange } from "@/components/filters";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Download, Trash2, ArrowDown, ArrowUp, CalendarPlus, CalendarClock, Settings2, ChevronDown, ChevronUp, Monitor } from "lucide-react";
import { TEST_TYPES, testTypeMeta as baseTestTypeMeta, downloadCSV, percentImprovement, bwCoefficient, sprintDistanceIn, mphToSeconds, secondsToMph } from "@/lib/domain";
import { toast } from "sonner";
import { AthleteCombobox } from "@/components/athlete-combobox";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";

export const Route = createFileRoute("/tests")({
  head: () => ({ meta: [{ title: "Tests — Strength Lab" }] }),
  component: TestsPage,
});

function TestsPage() {
  const qc = useQueryClient();
  const orgId = useCurrentOrgId();
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: tests = [] } = useQuery(testsQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: assignments = [] } = useQuery(testAssignmentsQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const { data: customMetrics = [] } = useQuery(customMetricsQO);
  const { data: athleteTeams = [] } = useQuery(athleteTeamsQO);
  const [expandedAssignment, setExpandedAssignment] = useState<string | null>(null);
  const [attemptsDraft, setAttemptsDraft] = useState<Record<string, [string, string, string]>>({});
  const allTestTypes = useMemo(() => {
    type TypeOpt = { value: string; label: string; unit: string; lowerIsBetter: boolean; group: string };
    const base: TypeOpt[] = TEST_TYPES.map((t) => ({
      value: t.value as string, label: t.label as string, unit: t.unit as string,
      lowerIsBetter: t.lowerIsBetter, group: t.group as string,
    }));
    const custom = customTypes.map((c) => ({
      value: c.value, label: c.label, unit: c.unit,
      lowerIsBetter: c.lower_is_better, group: c.group_name,
    }));
    // Metrics created on the Metrics page are testable too — surface them here
    // so coaches don't have to re-create the same thing as a test type.
    const metricUnit = (m: CustomMetric) =>
      m.unit || (m.measurement === "time" ? "s" : m.measurement === "height" ? "in" : "lb");
    const fromMetrics = customMetrics.map((m: CustomMetric) => ({
      value: m.test_type || m.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      label: m.name,
      unit: metricUnit(m),
      lowerIsBetter: m.lower_is_better,
      group: "Metrics",
    }));
    const seen = new Set(base.map((t) => t.value));
    const merged = [...base];
    for (const t of [...custom, ...fromMetrics]) {
      if (seen.has(t.value)) continue;
      seen.add(t.value);
      merged.push(t);
    }
    return merged;
  }, [customTypes, customMetrics]);

  const testTypeMeta = (v: string) => allTestTypes.find((t) => t.value === v) ?? baseTestTypeMeta(v);
  const [manageOpen, setManageOpen] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  const [testTypeFilter, setTestTypeFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedForm, setSchedForm] = useState({
    scope: "team" as "team" | "athlete",
    team_id: "", athlete_id: "",
    test_type: "sprint_40y",
    scheduled_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [form, setForm] = useState({
    athlete_id: "", test_type: "sprint_40y", value: "",
    test_date: new Date().toISOString().slice(0, 10), notes: "",
    input_as: "seconds" as "seconds" | "mph",
  });
  // Per-assignment input mode for the attempts grid (seconds vs mph).
  const [attemptsMode, setAttemptsMode] = useState<Record<string, "seconds" | "mph">>({});

  const [activeTeamId] = useActiveTeamId();
  const teamsByAthlete = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of athleteTeams) {
      const s = m.get(r.athlete_id) ?? new Set<string>();
      s.add(r.team_id);
      m.set(r.athlete_id, s);
    }
    return m;
  }, [athleteTeams]);
  const byId = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes]);
  const scopedAthletes = useMemo(
    () => filterAthletes(athletes, filters, activeTeamId, teamsByAthlete),
    [athletes, filters, activeTeamId, teamsByAthlete],
  );
  const scopedIds = useMemo(() => new Set(scopedAthletes.map((a) => a.id)), [scopedAthletes]);

  const filtered = useMemo(() => tests.filter((t) => {
    if (!scopedIds.has(t.athlete_id)) return false;
    if (testTypeFilter !== "all" && t.test_type !== testTypeFilter) return false;
    if (!inDateRange(t.test_date, filters)) return false;
    return true;
  }), [tests, scopedIds, testTypeFilter, filters]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.athlete_id) throw new Error("Select an athlete");
      let val = Number(form.value);
      if (!val || Number.isNaN(val)) throw new Error("Enter a valid value");
      const meta = testTypeMeta(form.test_type);
      const dist = sprintDistanceIn(form.test_type);
      if (form.input_as === "mph" && meta.unit === "s" && dist) {
        val = mphToSeconds(val, dist);
      }
      const organization_id = await getScopedOrgId();
      const { error } = await supabase.from("tests").insert({
        organization_id,
        athlete_id: form.athlete_id, test_type: form.test_type, value: val,
        unit: meta.unit, test_date: form.test_date, notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tests"] });
      toast.success("Test recorded");
      setOpen(false);
      setForm({ ...form, value: "", notes: "" });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("tests").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tests"] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const schedule = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No organization");
      if (schedForm.scope === "team" && !schedForm.team_id) throw new Error("Pick a team");
      if (schedForm.scope === "athlete" && !schedForm.athlete_id) throw new Error("Pick an athlete");
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("test_assignments" as never).insert({
        organization_id: orgId,
        team_id: schedForm.scope === "team" ? schedForm.team_id : null,
        athlete_id: schedForm.scope === "athlete" ? schedForm.athlete_id : null,
        test_type: schedForm.test_type,
        scheduled_date: schedForm.scheduled_date,
        notes: schedForm.notes.trim() || null,
        created_by: user?.id ?? null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["test_assignments"] });
      toast.success("Scheduled");
      setScheduleOpen(false);
      setSchedForm({ ...schedForm, notes: "" });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const delAssignment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("test_assignments" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["test_assignments"] }); toast.success("Removed"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const upcoming = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return [...assignments].filter((a) => a.scheduled_date >= today)
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  }, [assignments]);

  const logAttempts = useMutation({
    mutationFn: async (payload: { assignment: typeof assignments[number]; athleteId: string; attempts: [string, string, string]; mode: "seconds" | "mph" }) => {
      const meta = testTypeMeta(payload.assignment.test_type);
      const dist = sprintDistanceIn(payload.assignment.test_type);
      const shouldConvert = payload.mode === "mph" && meta.unit === "s" && !!dist;
      const organization_id = await getScopedOrgId();
      const rows = payload.attempts
        .map((v) => Number(v))
        .filter((v) => !Number.isNaN(v) && v > 0)
        .map((v, i) => ({
          organization_id,
          athlete_id: payload.athleteId,
          test_type: payload.assignment.test_type,
          value: shouldConvert ? mphToSeconds(v, dist as number) : v,
          unit: meta.unit,
          test_date: payload.assignment.scheduled_date,
          notes: `Attempt ${i + 1}${shouldConvert ? ` (entered ${v} mph)` : ""}`,
        }));
      if (!rows.length) throw new Error("Enter at least one attempt");
      const { error } = await supabase.from("tests").insert(rows);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["tests"] });
      toast.success("Attempts saved");
      setAttemptsDraft((prev) => ({ ...prev, [`${vars.assignment.id}:${vars.athleteId}`]: ["", "", ""] }));
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  // For each test row, compute improvement vs first result for that athlete/test type
  const rows = useMemo(() => filtered.map((t) => {
    const history = tests.filter((x) => x.athlete_id === t.athlete_id && x.test_type === t.test_type)
      .sort((a, b) => a.test_date.localeCompare(b.test_date));
    const first = history[0];
    const meta = testTypeMeta(t.test_type);
    const pct = first && first.id !== t.id ? percentImprovement(first.value, t.value, meta.lowerIsBetter) : null;
    const a = byId.get(t.athlete_id);
    const coef = (t.test_type.endsWith("_1rm") && a) ? bwCoefficient(t.value, a.bodyweight) : null;
    return { t, meta, pct, coef, athlete: a };
  }), [filtered, tests, byId]);

  const exportCSV = () => downloadCSV("tests.csv", rows.map(({ t, meta, pct, coef, athlete }) => ({
    date: t.test_date, athlete: athlete?.name ?? "", sport: athlete?.sport ?? "",
    grade: athlete?.grade ?? "", test: meta.label, value: t.value, unit: meta.unit,
    bw_coefficient: coef?.toFixed(3) ?? "", pct_improvement: pct != null ? pct.toFixed(2) : "",
    notes: t.notes ?? "",
  })));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Tests</h1>
          <p className="text-sm text-muted-foreground">Sprint times, jumps, and strength tests.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!rows.length}><Download className="h-4 w-4" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={() => setManageOpen(true)}><Settings2 className="h-4 w-4" /> Manage tests</Button>
          <Button variant="outline" size="sm" onClick={() => setScheduleOpen(true)} disabled={!athletes.length}><CalendarPlus className="h-4 w-4" /> Schedule</Button>
          <Button variant="outline" size="sm" asChild disabled={!athletes.length}>
            <Link to="/tests/kiosk"><Monitor className="h-4 w-4" /> Kiosk</Link>
          </Button>
          <Button size="sm" onClick={() => setOpen(true)} disabled={!athletes.length}><Plus className="h-4 w-4" /> Log test</Button>
        </div>
      </div>

      {upcoming.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4" /> Scheduled</CardTitle></CardHeader>
          <CardContent className="space-y-2 pt-0">
            {upcoming.map((a) => {
              const target = a.athlete_id
                ? (byId.get(a.athlete_id)?.name ?? "Athlete")
                : (teams.find((t) => t.id === a.team_id)?.name ?? "Team");
              const meta = testTypeMeta(a.test_type);
              const isOpen = expandedAssignment === a.id;
              const targetAthletes = a.athlete_id
                ? athletes.filter((x) => x.id === a.athlete_id)
                : athletes.filter(
                    (x) =>
                      x.team_id === a.team_id ||
                      athleteTeams.some((at) => at.athlete_id === x.id && at.team_id === a.team_id),
                  );
              const getDraft = (aid: string): [string, string, string] =>
                attemptsDraft[`${a.id}:${aid}`] ?? ["", "", ""];
              const setDraft = (aid: string, idx: 0 | 1 | 2, v: string) => {
                setAttemptsDraft((prev) => {
                  const key = `${a.id}:${aid}`;
                  const cur = prev[key] ?? ["", "", ""];
                  const next: [string, string, string] = [cur[0], cur[1], cur[2]];
                  next[idx] = v;
                  return { ...prev, [key]: next };
                });
              };
              return (
                <div key={a.id} className="rounded-md border">
                  <div className="flex items-center gap-2 p-2 text-sm">
                    <Button size="icon" variant="ghost" onClick={() => setExpandedAssignment(isOpen ? null : a.id)} aria-label="Toggle">
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                    <Badge variant="secondary">{meta.label}</Badge>
                    <span className="font-medium">{target}</span>
                    <span className="text-xs text-muted-foreground">{a.scheduled_date}</span>
                    {a.notes && <span className="line-clamp-1 text-xs text-muted-foreground">— {a.notes}</span>}
                    <Button size="icon" variant="ghost" className="ml-auto" onClick={() => delAssignment.mutate(a.id)} aria-label="Remove">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  {isOpen && (() => {
                    const dist = sprintDistanceIn(a.test_type);
                    const canMph = meta.unit === "s" && !!dist;
                    const mode = attemptsMode[a.id] ?? "seconds";
                    const unitLabel = canMph && mode === "mph" ? "mph" : meta.unit;
                    return (
                    <div className="space-y-2 border-t p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-muted-foreground">Log 3 attempts per athlete ({unitLabel})</div>
                        {canMph && (
                          <div className="inline-flex overflow-hidden rounded-md border text-xs">
                            <button type="button" className={`px-2 py-1 ${mode === "seconds" ? "bg-primary text-primary-foreground" : ""}`} onClick={() => setAttemptsMode((p) => ({ ...p, [a.id]: "seconds" }))}>Seconds</button>
                            <button type="button" className={`px-2 py-1 ${mode === "mph" ? "bg-primary text-primary-foreground" : ""}`} onClick={() => setAttemptsMode((p) => ({ ...p, [a.id]: "mph" }))}>MPH</button>
                          </div>
                        )}
                      </div>
                      {targetAthletes.length === 0 ? (
                        <div className="py-2 text-center text-xs text-muted-foreground">No athletes assigned.</div>
                      ) : targetAthletes.map((ath) => {
                        const draft = getDraft(ath.id);
                        return (
                          <div key={ath.id} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 p-2">
                            <span className="min-w-32 flex-1 text-sm font-medium">{ath.name}</span>
                            {[0, 1, 2].map((i) => (
                              <Input
                                key={i}
                                inputMode="decimal"
                                placeholder={`#${i + 1}`}
                                className="w-20"
                                value={draft[i as 0 | 1 | 2]}
                                onChange={(e) => setDraft(ath.id, i as 0 | 1 | 2, e.target.value)}
                              />
                            ))}
                            <Button
                              size="sm"
                              onClick={() => logAttempts.mutate({ assignment: a, athleteId: ath.id, attempts: draft, mode })}
                              disabled={logAttempts.isPending || !draft.some((v) => v.trim())}
                            >
                              Save
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                    );
                  })()}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Filters value={filters} onChange={setFilters} athletes={athletes} />
      <div className="flex gap-2">
        <Select value={testTypeFilter} onValueChange={setTestTypeFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Test type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All test types</SelectItem>
            {allTestTypes.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          {athletes.length === 0 ? "Add an athlete first." : "No tests match your filters."}
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows.map(({ t, meta, pct, coef, athlete }) => (
            <Card key={t.id}>
              <CardContent className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{athlete?.name ?? "—"}</span>
                    <Badge variant="secondary">{meta.label}</Badge>
                    <span className="text-xs text-muted-foreground">{t.test_date}</span>
                  </div>
                  {t.notes && <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{t.notes}</div>}
                </div>
                <div className="text-right">
                  <div className="stat-number text-xl tabular-nums">{t.value}<span className="ml-1 text-sm text-muted-foreground">{meta.unit}</span></div>
                  <div className="mt-0.5 flex items-center justify-end gap-2 text-xs">
                    {coef != null && <span className="text-muted-foreground">BW coef {coef.toFixed(2)}</span>}
                    {pct != null && pct !== 0 && (
                      <span className={pct > 0 ? "inline-flex items-center gap-0.5 text-[color:var(--color-success)]" : "inline-flex items-center gap-0.5 text-destructive"}>
                        {pct > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                        {Math.abs(pct).toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => del.mutate(t.id)} aria-label="Delete"><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log a test</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Athlete</Label>
              <AthleteCombobox athletes={athletes} value={form.athlete_id} onChange={(v) => setForm({ ...form, athlete_id: v })} />
            </div>
            <div>
              <Label>Test type</Label>
              <Select value={form.test_type} onValueChange={(v) => setForm({ ...form, test_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{allTestTypes.map((t) => <SelectItem key={t.value} value={t.value}>{t.label} ({t.unit})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {(() => {
              const meta = testTypeMeta(form.test_type);
              const dist = sprintDistanceIn(form.test_type);
              const canMph = meta.unit === "s" && !!dist;
              const unitLabel = canMph && form.input_as === "mph" ? "mph" : meta.unit;
              const converted = canMph && form.input_as === "mph" && Number(form.value) > 0
                ? mphToSeconds(Number(form.value), dist as number)
                : canMph && form.input_as === "seconds" && Number(form.value) > 0
                ? secondsToMph(Number(form.value), dist as number)
                : null;
              return (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <Label>Value ({unitLabel})</Label>
                      {canMph && (
                        <div className="inline-flex overflow-hidden rounded-md border text-xs">
                          <button type="button" className={`px-2 py-0.5 ${form.input_as === "seconds" ? "bg-primary text-primary-foreground" : ""}`} onClick={() => setForm({ ...form, input_as: "seconds" })}>Seconds</button>
                          <button type="button" className={`px-2 py-0.5 ${form.input_as === "mph" ? "bg-primary text-primary-foreground" : ""}`} onClick={() => setForm({ ...form, input_as: "mph" })}>MPH</button>
                        </div>
                      )}
                    </div>
                    <Input inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
                    {converted != null && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        ≈ {converted.toFixed(2)} {form.input_as === "mph" ? "s" : "mph"}
                      </div>
                    )}
                  </div>
                  <div>
                    <Label>Date</Label>
                    <Input type="date" value={form.test_date} onChange={(e) => setForm({ ...form, test_date: e.target.value })} />
                  </div>
                </div>
              );
            })()}
            <div>
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Save test</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schedule tests</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Assign to</Label>
              <Select value={schedForm.scope} onValueChange={(v) => setSchedForm({ ...schedForm, scope: v as "team" | "athlete" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">Whole team</SelectItem>
                  <SelectItem value="athlete">One athlete</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {schedForm.scope === "team" ? (
              <div>
                <Label>Team</Label>
                <Select value={schedForm.team_id} onValueChange={(v) => setSchedForm({ ...schedForm, team_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select team" /></SelectTrigger>
                  <SelectContent>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label>Athlete</Label>
                <AthleteCombobox athletes={athletes} value={schedForm.athlete_id} onChange={(v) => setSchedForm({ ...schedForm, athlete_id: v })} />
              </div>
            )}
            <div>
              <Label>Test type</Label>
              <Select value={schedForm.test_type} onValueChange={(v) => setSchedForm({ ...schedForm, test_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{allTestTypes.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={schedForm.scheduled_date} onChange={(e) => setSchedForm({ ...schedForm, scheduled_date: e.target.value })} />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={schedForm.notes} onChange={(e) => setSchedForm({ ...schedForm, notes: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button onClick={() => schedule.mutate()} disabled={schedule.isPending}>Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ManageTestTypesDialog open={manageOpen} onOpenChange={setManageOpen} customTypes={customTypes} orgId={orgId} />
    </div>
  );
}

function ManageTestTypesDialog({
  open, onOpenChange, customTypes, orgId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customTypes: CustomTestType[];
  orgId: string | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ label: "", unit: "", group_name: "Other", lower_is_better: false });

  const add = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No organization");
      const label = form.label.trim();
      if (!label) throw new Error("Name is required");
      const value = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
      if (!value) throw new Error("Name must include letters or numbers");
      const { error } = await supabase.from("test_types" as never).insert({
        organization_id: orgId, value, label, unit: form.unit.trim(),
        lower_is_better: form.lower_is_better, group_name: form.group_name.trim() || "Other",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["test_types"] });
      toast.success("Test added");
      setForm({ label: "", unit: "", group_name: "Other", lower_is_better: false });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("test_types" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["test_types"] }); toast.success("Removed"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Manage tests</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Built-in tests</div>
            <div className="flex flex-wrap gap-1">
              {TEST_TYPES.map((t) => <Badge key={t.value} variant="secondary">{t.label}</Badge>)}
            </div>
          </div>

          {customTypes.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Custom tests</div>
              {customTypes.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  <span className="font-medium">{c.label}</span>
                  <span className="text-xs text-muted-foreground">{c.unit || "—"} · {c.group_name} · {c.lower_is_better ? "lower is better" : "higher is better"}</span>
                  <Button size="icon" variant="ghost" className="ml-auto" onClick={() => remove.mutate(c.id)} aria-label="Remove">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3 rounded-md border p-3">
            <div className="text-sm font-medium">Add a test</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Name</Label>
                <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. 20m Sprint" />
              </div>
              <div>
                <Label>Unit</Label>
                <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="s, in, lb, reps…" />
              </div>
              <div>
                <Label>Group</Label>
                <Input value={form.group_name} onChange={(e) => setForm({ ...form, group_name: e.target.value })} placeholder="Speed, Jumps, Strength…" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.lower_is_better} onCheckedChange={(v) => setForm({ ...form, lower_is_better: v === true })} />
              Lower value is better (e.g. sprint times)
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => add.mutate()} disabled={add.isPending || !form.label.trim()}>Add test</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
