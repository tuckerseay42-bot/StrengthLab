import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { estimate1RM, ONE_RM_META } from "@/lib/one-rm";
import { useOrg1RMFormula } from "@/hooks/use-1rm-formula";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { athletesQO, testsQO, liftsQO, attendanceQO, teamsQO, exercisesQO, exerciseRelationshipsQO, programsQO, repMaxesQO, testTypesQO, athleteDisplayName, spiderTemplatesQO } from "@/lib/queries";
import { pickTemplate } from "@/lib/spider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TEST_TYPES, testTypeMeta as baseTestTypeMeta, bwCoefficient, percentImprovement, estimateMax } from "@/lib/domain";
import { ArrowLeft } from "lucide-react";
import { AthleteInvite } from "@/components/athlete-invite";
import { AthleteKpiDashboard } from "@/components/athlete-kpi-dashboard";
import { BadgeShelf } from "@/components/badge-shelf";
import { AthleteHeroCard } from "@/components/athlete-hero-card";
import { AthleteSpiderGraph } from "@/components/athlete-spider-graph";
import { AthleteQuickStats } from "@/components/athlete-quick-stats";

export const Route = createFileRoute("/athletes/$id")({
  head: () => ({ meta: [{ title: "Athlete — Strength Lab" }] }),
  component: AthleteCard,
  notFoundComponent: () => (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Athlete not found</h1>
      <Link to="/athletes" className="mt-3 inline-block text-primary underline">Back to roster</Link>
    </div>
  ),
});

function AthleteCard() {
  const { id } = Route.useParams();
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: tests = [] } = useQuery(testsQO);
  const { data: lifts = [] } = useQuery(liftsQO);
  const { data: attendance = [] } = useQuery(attendanceQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: exercises = [] } = useQuery(exercisesQO);
  const { data: rels = [] } = useQuery(exerciseRelationshipsQO);
  const { data: programs = [] } = useQuery(programsQO);
  const { data: repMaxes = [] } = useQuery(repMaxesQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const { data: spiderTemplates = [] } = useQuery(spiderTemplatesQO);

  const testTypeMeta = useMemo(() => {
    const m = new Map(customTypes.map((c) => [c.value, { value: c.value, label: c.label, unit: c.unit, lowerIsBetter: c.lower_is_better, group: c.group_name }]));
    return (v: string) => m.get(v) ?? baseTestTypeMeta(v);
  }, [customTypes]);

  const allTestTypeDefs = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string; unit: string; lowerIsBetter: boolean }[] = [];
    for (const t of TEST_TYPES) { seen.add(t.value); out.push({ value: t.value, label: t.label, unit: t.unit, lowerIsBetter: t.lowerIsBetter }); }
    for (const c of customTypes) if (!seen.has(c.value)) { seen.add(c.value); out.push({ value: c.value, label: c.label, unit: c.unit, lowerIsBetter: c.lower_is_better }); }
    return out;
  }, [customTypes]);

  const athlete = athletes.find((a) => a.id === id);
  const athleteId = athlete?.id ?? "";
  const dashboardTemplate = useMemo(
    () => (athlete ? pickTemplate(spiderTemplates, athlete) : null),
    [spiderTemplates, athlete],
  );
  const showBadges = dashboardTemplate?.options?.show_badges ?? true;
  const team = teams.find((t) => t.id === athlete?.team_id);
  const teammates = useMemo(() => athletes.filter((a) => a.team_id === athlete?.team_id), [athletes, athlete?.team_id]);
  const displayName = athlete ? athleteDisplayName(athlete) : "";

  const myTests = useMemo(() => tests.filter((t) => t.athlete_id === athleteId), [tests, athleteId]);
  const myLifts = useMemo(() => lifts.filter((l) => l.athlete_id === athleteId), [lifts, athleteId]);
  const myAttendance = useMemo(() => attendance.filter((a) => a.athlete_id === athleteId), [attendance, athleteId]);

  const bestByType = useMemo(() => {
    const m = new Map<string, { value: number; date: string }>();
    for (const t of myTests) {
      const meta = testTypeMeta(t.test_type);
      const cur = m.get(t.test_type);
      const better = !cur || (meta.lowerIsBetter ? t.value < cur.value : t.value > cur.value);
      if (better) m.set(t.test_type, { value: t.value, date: t.test_date });
    }
    return m;
  }, [myTests]);

  const improvements = useMemo(() => {
    return allTestTypeDefs.map((tt) => {
      const rows = myTests.filter((t) => t.test_type === tt.value).sort((a, b) => a.test_date.localeCompare(b.test_date));
      if (rows.length < 2) return null;
      const first = rows[0].value; const latest = rows[rows.length - 1].value;
      return { type: tt.label, delta: percentImprovement(first, latest, tt.lowerIsBetter) };
    }).filter(Boolean);
  }, [myTests, allTestTypeDefs]);

  const rankings = useMemo(() => {
    return allTestTypeDefs.map((tt) => {
      const rowsByAthlete = new Map<string, number>();
      for (const t of tests.filter((x) => x.test_type === tt.value)) {
        const cur = rowsByAthlete.get(t.athlete_id);
        const better = cur == null || (tt.lowerIsBetter ? t.value < cur : t.value > cur);
        if (better) rowsByAthlete.set(t.athlete_id, t.value);
      }
      const teamRows = teammates.map((a) => ({ id: a.id, v: rowsByAthlete.get(a.id) })).filter((r) => r.v != null) as { id: string; v: number }[];
      if (!teamRows.length || !rowsByAthlete.has(athleteId)) return null;
      teamRows.sort((a, b) => tt.lowerIsBetter ? a.v - b.v : b.v - a.v);
      const rank = teamRows.findIndex((r) => r.id === athleteId) + 1;
      return { type: tt.label, unit: tt.unit, rank, of: teamRows.length, value: rowsByAthlete.get(athleteId)! };
    }).filter(Boolean);
  }, [tests, teammates, athleteId, allTestTypeDefs]);

  const formula = useOrg1RMFormula();
  const attendancePct = myAttendance.length ? Math.round((myAttendance.filter((a) => a.present).length / myAttendance.length) * 100) : 0;

  const recentLifts = myLifts.slice(0, 10);
  const recentAttendance = myAttendance.slice(0, 14);

  // Best actual load per exercise (matched by name → exercise id)
  const exByName = useMemo(() => new Map(exercises.map((e) => [e.name.toLowerCase(), e])), [exercises]);
  const bestLoadByExerciseId = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of myLifts) {
      if (l.load == null) continue;
      const ex = exByName.get(l.exercise.toLowerCase());
      if (!ex) continue;
      const cur = m.get(ex.id);
      if (cur == null || l.load > cur) m.set(ex.id, l.load);
    }
    // Also include rep_maxes rollup (Epley e1RM for reps > 1)
    for (const r of repMaxes.filter((x) => x.athlete_id === athleteId)) {
      const exId = r.exercise_id ?? exByName.get(r.exercise_name.toLowerCase())?.id;
      if (!exId) continue;
      const e1rm = estimate1RM(Number(r.load), r.reps, formula) ?? Number(r.load);
      const cur = m.get(exId);
      if (cur == null || e1rm > cur) m.set(exId, e1rm);
    }
    return m;
  }, [myLifts, exByName, repMaxes, athleteId, formula]);

  // Predicted 1RMs derived from rep_maxes
  const predicted1RMs = useMemo(() => {
    const byExercise = new Map<string, { name: string; e1rm: number; reps: number; load: number }>();
    for (const r of repMaxes.filter((x) => x.athlete_id === athleteId)) {
      const e1rm = estimate1RM(Number(r.load), r.reps, formula) ?? Number(r.load);
      const key = r.exercise_id ?? r.exercise_name;
      const cur = byExercise.get(key);
      if (!cur || e1rm > cur.e1rm) byExercise.set(key, { name: r.exercise_name, e1rm, reps: r.reps, load: Number(r.load) });
    }
    return Array.from(byExercise.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [repMaxes, athleteId, formula]);

  const assignedProgram = programs.find((p) => p.id === athlete?.program_id);

  // Estimate max for exercises with a relationship but no direct log
  const estimates = useMemo(() => {
    const linkedIds = new Set<string>();
    for (const r of rels) { linkedIds.add(r.from_exercise_id); linkedIds.add(r.to_exercise_id); }
    const rows: { exercise: string; value: number; source: string; ratio: number }[] = [];
    for (const id of linkedIds) {
      if (bestLoadByExerciseId.has(id)) continue;
      const est = estimateMax(id, bestLoadByExerciseId, rels);
      if (!est) continue;
      const ex = exercises.find((e) => e.id === id);
      const src = exercises.find((e) => e.id === est.sourceExerciseId);
      if (!ex || !src) continue;
      rows.push({ exercise: ex.name, value: est.value, source: src.name, ratio: est.ratio });
    }
    return rows.sort((a, b) => a.exercise.localeCompare(b.exercise));
  }, [rels, bestLoadByExerciseId, exercises]);

  if (athletes.length && !athlete) throw notFound();
  if (!athlete) return <div className="py-10 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <Link to="/athletes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to roster
      </Link>

      <AthleteHeroCard
        athlete={athlete}
        team={team ?? null}
        program={assignedProgram ?? null}
        tests={tests}
        lifts={lifts}
        attendance={attendance}
      />

      {(athlete.bodyweight != null || athlete.height_in != null) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {athlete.bodyweight != null && <Badge variant="outline">{athlete.bodyweight} lb</Badge>}
          {athlete.height_in != null && <Badge variant="outline">{athlete.height_in}″</Badge>}
          <span className="ml-auto">
            <span className="stat-number text-foreground">{attendancePct}%</span> attendance
          </span>
        </div>
      )}

      <AthleteQuickStats athlete={athlete} lifts={lifts} attendance={attendance} />

      <AthleteSpiderGraph athlete={athlete} />

      <AthleteKpiDashboard
        athlete={athlete}
        tests={tests}
        lifts={lifts}
        attendance={attendance}
        repMaxes={repMaxes}
        customTypes={customTypes}
        athletesAll={athletes}
      />

      {showBadges && (
        <BadgeShelf
          athlete={athlete}
          tests={myTests}
          lifts={myLifts}
          attendance={myAttendance}
          repMaxes={repMaxes.filter((r) => r.athlete_id === athleteId)}
          canAward
        />
      )}



      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Personal Records</CardTitle></CardHeader>
          <CardContent>
            {bestByType.size === 0 ? <p className="text-sm text-muted-foreground">No tests recorded yet.</p> : (
              <ul className="divide-y">
                {Array.from(bestByType.entries()).map(([type, v]) => {
                  const m = testTypeMeta(type);
                  const coef = ["bench_1rm","squat_1rm","deadlift_1rm","power_clean_1rm"].includes(type) ? bwCoefficient(v.value, athlete.bodyweight) : null;
                  return (
                    <li key={type} className="flex items-center justify-between py-2 text-sm">
                      <span>{m.label}</span>
                      <span className="font-mono">
                        {v.value}{m.unit}
                        {coef != null && <span className="ml-2 text-xs text-muted-foreground">coef {coef.toFixed(2)}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Team Rankings</CardTitle></CardHeader>
          <CardContent>
            {!rankings.length ? <p className="text-sm text-muted-foreground">Not enough team data yet.</p> : (
              <ul className="divide-y">
                {rankings.map((r) => r && (
                  <li key={r.type} className="flex items-center justify-between py-2 text-sm">
                    <span>{r.type}</span>
                    <span><span className="font-semibold">#{r.rank}</span> <span className="text-muted-foreground">of {r.of}</span> <span className="ml-2 font-mono">{r.value}{r.unit}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Performance Trend</CardTitle></CardHeader>
          <CardContent>
            {!improvements.length ? <p className="text-sm text-muted-foreground">Two data points per test needed to trend.</p> : (
              <ul className="space-y-2">
                {improvements.map((i) => i && (
                  <li key={i.type} className="flex items-center justify-between text-sm">
                    <span>{i.type}</span>
                    <span className={i.delta >= 0 ? "font-mono text-emerald-500" : "font-mono text-destructive"}>{i.delta >= 0 ? "+" : ""}{i.delta.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent Attendance</CardTitle></CardHeader>
          <CardContent>
            {!recentAttendance.length ? <p className="text-sm text-muted-foreground">No sessions logged.</p> : (
              <div className="flex flex-wrap gap-1">
                {recentAttendance.map((a) => (
                  <span key={a.id} title={`${a.session_date} — ${a.present ? "Present" : "Absent"}`}
                    className={`h-6 w-6 rounded ${a.present ? "bg-primary" : "bg-muted"}`} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Predicted 1RM</CardTitle>
            <p className="text-[11px] text-muted-foreground font-mono">
              {ONE_RM_META[formula].label} — {ONE_RM_META[formula].expression}
            </p>
          </CardHeader>
          <CardContent>
            {predicted1RMs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rep-max data yet. Log lifts in the Training View — the nightly rollup will populate this.</p>
            ) : (
              <ul className="divide-y">
                {predicted1RMs.map((p) => (
                  <li key={p.name} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">from {p.load} lb × {p.reps} (Epley)</div>
                    </div>
                    <div className="text-right">
                      <div className="stat-number text-lg tabular-nums">{Math.round(p.e1rm / 5) * 5}<span className="ml-1 text-xs text-muted-foreground">lb</span></div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">e1RM</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Estimated Maxes</CardTitle>
          </CardHeader>
          <CardContent>
            {!estimates.length ? (
              <p className="text-sm text-muted-foreground">
                No estimates available. Add exercise relationships in the Exercise Library to project maxes for lifts this athlete hasn't logged.
              </p>
            ) : (
              <ul className="divide-y">
                {estimates.map((e) => (
                  <li key={e.exercise} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <div className="font-medium">{e.exercise}</div>
                      <div className="text-xs text-muted-foreground">
                        derived from {e.source} × <span className="font-mono">{(e.ratio * 100 / 100).toFixed(2).replace(/\.?0+$/, "")}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="stat-number text-lg tabular-nums">
                        ~{Math.round(e.value / 5) * 5}<span className="ml-1 text-xs text-muted-foreground">lb</span>
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">estimate</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>


        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="text-base">Recent Workouts</CardTitle></CardHeader>
          <CardContent>
            {!recentLifts.length ? <p className="text-sm text-muted-foreground">No lifts logged yet.</p> : (
              <ul className="divide-y">
                {recentLifts.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <div className="font-medium">{l.exercise}</div>
                      <div className="text-xs text-muted-foreground">{l.lift_date}{l.notes ? ` · ${l.notes}` : ""}</div>
                    </div>
                    <div className="font-mono text-right text-xs">
                      {l.load != null && <div>{l.load} lb {l.sets && l.reps ? `· ${l.sets}×${l.reps}` : ""}</div>}
                      {l.velocity != null && <div className="text-muted-foreground">{l.velocity} m/s</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {athlete.notes && (
          <Card className="md:col-span-2">
            <CardHeader><CardTitle className="text-base">Coach Notes</CardTitle></CardHeader>
            <CardContent><p className="whitespace-pre-wrap text-sm">{athlete.notes}</p></CardContent>
          </Card>
        )}

        <div className="md:col-span-2">
          <AthleteInvite
            athleteName={displayName}
            joinToken={athlete.join_token}
            defaultEmail={athlete.athlete_email}
            linked={!!athlete.user_id}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Link to="/athletes" search={{ edit: athlete.id }}><Button variant="outline" size="sm">Edit profile</Button></Link>
      </div>
    </div>
  );
}
