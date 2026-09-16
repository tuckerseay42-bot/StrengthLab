import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  athletesQO, testsQO, testAssignmentsQO, testTypesQO, liftsQO, attendanceQO, repMaxesQO, teamsQO, programsQO, athleteDisplayName, spiderTemplatesQO, type Athlete, type Team,
} from "@/lib/queries";
import { pickTemplate } from "@/lib/spider";
import { supabase as sb } from "@/integrations/supabase/client";
import { LogOut, Trophy, Dumbbell, TrendingUp, ClipboardList, Check, KeyRound, Download, Mail, ListOrdered } from "lucide-react";
import { TEST_TYPES, testTypeMeta as baseTestTypeMeta, SPORTS, GENDERS, GENDER_LABELS } from "@/lib/domain";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { buildAthleteResultsPdf } from "@/lib/athlete-results-export";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { useServerFn } from "@tanstack/react-start";
import { setAthletePin, getMyPinStatus } from "@/lib/athlete-pin.functions";
import { AthleteKpiDashboard } from "@/components/athlete-kpi-dashboard";
import { BadgeShelf } from "@/components/badge-shelf";
import { AthleteProfileHero } from "@/components/athlete-profile-hero";
import { AthleteHeroCard } from "@/components/athlete-hero-card";
import { AthleteSpiderGraph } from "@/components/athlete-spider-graph";
import { PredictedHeightTool } from "@/components/predicted-height-tool";
import { TodaysLiftCard } from "@/components/todays-lift-card";


export const Route = createFileRoute("/athlete")({
  head: () => ({ meta: [{ title: "My Dashboard — Strength Lab" }, { name: "robots", content: "noindex" }] }),
  validateSearch: (s: Record<string, unknown>): { claim?: string; setupPin?: boolean } => ({ claim: s.claim as string | undefined, setupPin: s.setupPin === "1" || s.setupPin === true }),
  component: AthletePortal,
});

function AthletePortal() {
  const { claim, setupPin } = Route.useSearch();
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!claim || !userId) return;
    setClaiming(true);
    sb.rpc("claim_athlete" as never, { _token: claim } as never).then(({ error }) => {
      setClaiming(false);
      if (error) setClaimError(error.message);
      else navigate({ to: "/athlete", search: setupPin ? { setupPin: true } : {}, replace: true });
    });
  }, [claim, userId, setupPin, navigate]);

  if (userId === undefined) return <div className="py-16 text-center text-muted-foreground">Loading…</div>;

  if (!userId) {
    return (
      <div className="mx-auto max-w-md space-y-6 py-12">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Athlete sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in with your email and password.</p>
        </div>
        <AthletePasswordAuth />
        <div className="text-center text-xs text-muted-foreground">
          New here? Ask your coach for your personal QR code — scan it once to link your account.
        </div>
        <div className="pt-4 border-t text-center">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Coach / Admin</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/auth" search={{ redirect: "/athlete" } as never}>Sign in to preview</Link>
          </Button>
        </div>
      </div>
    );
  }


  if (claiming) return <div className="py-16 text-center text-muted-foreground">Linking your account…</div>;
  if (claimError) return <div className="mx-auto max-w-md py-16 text-center text-destructive">{claimError}</div>;

  return <Dashboard userId={userId} setupPin={setupPin} />;
}

function Dashboard({ userId, setupPin }: { userId: string; setupPin?: boolean }) {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: tests = [] } = useQuery(testsQO);
  const { data: assignments = [] } = useQuery(testAssignmentsQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const { data: lifts = [] } = useQuery(liftsQO);
  const { data: attendance = [] } = useQuery(attendanceQO);
  const { data: repMaxes = [] } = useQuery(repMaxesQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: programs = [] } = useQuery(programsQO);
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

  const linked = athletes.find((a) => a.user_id === userId) as Athlete | undefined;
  const [previewId, setPreviewId] = useState<string | null>(null);
  const me = linked ?? (previewId ? athletes.find((a) => a.id === previewId) : undefined);
  const dashboardTemplate = useMemo(
    () => (me ? pickTemplate(spiderTemplates, me) : null),
    [spiderTemplates, me],
  );
  const showBadges = dashboardTemplate?.options?.show_badges ?? true;

  // Assigned tests visible to this athlete (their own + their team's), from today forward
  const myAssignments = useMemo(() => {
    if (!me) return [];
    const today = new Date().toISOString().slice(0, 10);
    return assignments
      .filter((a) => a.scheduled_date >= today)
      .filter((a) => a.athlete_id === me.id || (a.team_id && a.team_id === me.team_id))
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  }, [assignments, me]);

  const isDone = (a: { test_type: string; scheduled_date: string }) =>
    !!me && tests.some((t) => t.athlete_id === me.id && t.test_type === a.test_type && t.test_date === a.scheduled_date);

  const [logFor, setLogFor] = useState<string | null>(null);
  const [logValue, setLogValue] = useState("");
  const logResult = useMutation({
    mutationFn: async (a: { id: string; test_type: string; scheduled_date: string }) => {
      if (!me) throw new Error("No athlete");
      const val = Number(logValue);
      if (!val || Number.isNaN(val)) throw new Error("Enter a value");
      const meta = testTypeMeta(a.test_type);
      const { error } = await supabase.from("tests").insert({
        organization_id: me.organization_id,
        athlete_id: me.id, test_type: a.test_type, value: val,
        unit: meta.unit, test_date: a.scheduled_date, notes: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tests"] });
      toast.success("Logged");
      setLogFor(null); setLogValue("");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });


  const myTestTypes = useMemo(() => {
    if (!me) return [];
    const seen = new Set(tests.filter((t) => t.athlete_id === me.id).map((t) => t.test_type));
    return allTestTypeDefs.filter((t) => seen.has(t.value));
  }, [tests, me, allTestTypeDefs]);

  const [metric, setMetric] = useState<string | null>(null);
  useEffect(() => {
    if (!metric && myTestTypes.length) setMetric(myTestTypes[0].value);
  }, [myTestTypes, metric]);

  // Trend series for chosen metric
  const trend = useMemo(() => {
    if (!me || !metric) return { points: [] as { date: string; value: number; best: number; teamAvg: number | null }[], meta: testTypeMeta(metric ?? "") };
    const meta = testTypeMeta(metric);
    const mine = tests
      .filter((t) => t.athlete_id === me.id && t.test_type === metric)
      .slice()
      .sort((a, b) => a.test_date.localeCompare(b.test_date));

    // running best
    let best: number | null = null;
    const points = mine.map((t) => {
      const v = Number(t.value);
      if (best == null) best = v;
      else best = meta.lowerIsBetter ? Math.min(best, v) : Math.max(best, v);
      // team avg on that date (same team, same test)
      const sameDay = tests.filter(
        (x) => x.test_type === metric && x.test_date === t.test_date && athletes.find((a) => a.id === x.athlete_id)?.team_id === me.team_id,
      );
      const teamAvg = sameDay.length ? sameDay.reduce((s, x) => s + Number(x.value), 0) / sameDay.length : null;
      return { date: t.test_date.slice(5), value: v, best, teamAvg: teamAvg != null ? Number(teamAvg.toFixed(2)) : null };
    });
    return { points, meta };
  }, [tests, athletes, me, metric]);

  const leaderboardRank = useMemo(() => {
    if (!me) return [];
    return allTestTypeDefs.map((tt) => {
      const meta = testTypeMeta(tt.value);
      const bestByAthlete = new Map<string, number>();
      for (const t of tests.filter((x) => x.test_type === tt.value)) {
        const cur = bestByAthlete.get(t.athlete_id);
        const better = cur == null || (meta.lowerIsBetter ? t.value < cur : t.value > cur);
        if (better) bestByAthlete.set(t.athlete_id, t.value);
      }
      const myGender = (me.gender ?? "").trim().toLowerCase();
      const mySport = (me.sport ?? "").trim().toLowerCase();
      const pool = athletes.filter((a) => {
        const g = (a.gender ?? "").trim().toLowerCase();
        const s = (a.sport ?? "").trim().toLowerCase();
        if (myGender && g && g !== myGender) return false;
        if (mySport && s && s !== mySport) return false;
        return true;
      });
      const rows = pool.map((a) => ({ id: a.id, v: bestByAthlete.get(a.id) })).filter((r) => r.v != null) as { id: string; v: number }[];
      if (!rows.length || !bestByAthlete.has(me.id)) return null;
      rows.sort((a, b) => meta.lowerIsBetter ? a.v - b.v : b.v - a.v);
      const rank = rows.findIndex((r) => r.id === me.id) + 1;
      const myValue = bestByAthlete.get(me.id)!;
      // Score = percentile within the same pool used for rank, 0..10 (10 = best).
      const poolValues = rows.map((r) => r.v);
      const worseCount = meta.lowerIsBetter
        ? poolValues.filter((v) => v > myValue).length
        : poolValues.filter((v) => v < myValue).length;
      const score = Math.round((worseCount / poolValues.length) * 100) / 10;
      return {
        type: tt.label, unit: tt.unit, rank, of: rows.length, value: myValue, score,
        scope: [me.gender, me.sport].filter(Boolean).join(" · ") || "All",
      };
    }).filter(Boolean) as { type: string; unit: string; rank: number; of: number; value: number; score: number; scope: string }[];

  }, [tests, athletes, me, allTestTypeDefs, testTypeMeta]);

  // Composite = average score across every test the athlete has a ranked
  // result for. Mirrors the "6.9/10 · composite (N of M tests)" summary
  // coaches are used to seeing on a testing report.
  const composite = useMemo(() => {
    if (!leaderboardRank.length) return null;
    const avg = leaderboardRank.reduce((s, r) => s + r.score, 0) / leaderboardRank.length;
    return { value: Math.round(avg * 10) / 10, count: leaderboardRank.length };
  }, [leaderboardRank]);

  const buildResultsPdf = () => {
    if (!me) return null;
    const team = teams.find((t) => t.id === me.team_id) ?? null;
    return buildAthleteResultsPdf({
      athleteName: athleteDisplayName(me),
      team: team?.name ?? null,
      composite: composite?.value ?? null,
      testsUsed: composite?.count ?? 0,
      rows: leaderboardRank.map((r) => ({
        test: r.type,
        result: `${r.value} ${r.unit}`,
        score: r.score.toFixed(1),
        rank: `#${r.rank} of ${r.of}`,
      })),
    });
  };
  const downloadResults = () => {
    if (!me) return;
    const doc = buildResultsPdf();
    if (!doc) return;
    doc.save(`${athleteDisplayName(me).replace(/\s+/g, "_")}_results.pdf`);
  };
  const emailResults = async () => {
    if (!me) return;
    const doc = buildResultsPdf();
    if (!doc) return;
    const filename = `${athleteDisplayName(me).replace(/\s+/g, "_")}_results.pdf`;
    const file = new File([doc.output("blob")], filename, { type: "application/pdf" });
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: "My Testing Results" });
      } catch {
        // User cancelled the share sheet — nothing else to do.
      }
      return;
    }
    doc.save(filename);
    toast.info("Downloaded your results — attach the file to your email.");
  };

  if (!me) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <h1 className="text-xl font-semibold">Admin preview</h1>
        <p className="text-sm text-muted-foreground">Your account isn't linked to an athlete. Pick one to preview their dashboard.</p>
        <Select value={previewId ?? ""} onValueChange={setPreviewId}>
          <SelectTrigger className="mx-auto w-[260px]"><SelectValue placeholder="Select an athlete…" /></SelectTrigger>
          <SelectContent>
            {athletes.map((a) => (
              <SelectItem key={a.id} value={a.id}>{athleteDisplayName(a)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div><Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}><LogOut className="mr-1 h-4 w-4" /> Sign out</Button></div>
      </div>
    );
  }


  const avg = trend.points.length
    ? trend.points.reduce((s, p) => s + p.value, 0) / trend.points.length
    : null;
  const bestOverall = trend.points.length
    ? trend.points[trend.points.length - 1].best
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 py-4">
      {!linked && (
        <div className="flex items-center justify-between rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Admin preview — viewing as <span className="font-medium text-foreground">{athleteDisplayName(me)}</span></span>
          <Button variant="ghost" size="sm" className="h-7" onClick={() => setPreviewId(null)}>Change</Button>
        </div>
      )}
      <div className="flex items-center justify-end">
        <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
          <LogOut className="mr-1 h-4 w-4" /> Sign out
        </Button>
      </div>

      {/* Composite testing score — the headline number, up top like a real report */}
      {composite && (
        <Card className="overflow-hidden border-border/60">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-4xl font-bold tracking-tight text-primary">{composite.value.toFixed(1)}</span>
                <span className="text-lg text-muted-foreground">/10</span>
              </div>
              <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Composite · {composite.count} of {composite.count} tests
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={downloadResults}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Download My Results
              </Button>
              <Button size="sm" variant="outline" onClick={() => void emailResults()}>
                <Mail className="mr-1.5 h-3.5 w-3.5" /> Email Me My Results
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <AthleteHeroCard
        athlete={me}
        team={teams.find((t) => t.id === me.team_id) ?? null}
        program={programs.find((p) => p.id === me.program_id) ?? null}
        tests={tests}
        lifts={lifts}
        attendance={attendance}
      />

      {/* Today's Lift — hero */}
      <TodaysLiftCard athleteId={me.id} programId={me.program_id ?? null} />

      <AthleteSpiderGraph athlete={me} />

      <AthleteProfileHero
        athlete={me}
        athletes={athletes}
        tests={tests}
        attendance={attendance}
      />

      <AthleteKpiDashboard
        athlete={me}
        tests={tests}
        lifts={lifts}
        attendance={attendance}
        repMaxes={repMaxes}
        customTypes={customTypes}
        athletesAll={athletes}
      />

      {showBadges && (
        <BadgeShelf
          athlete={me}
          tests={tests.filter((t) => t.athlete_id === me.id)}
          lifts={lifts.filter((l) => l.athlete_id === me.id)}
          attendance={attendance.filter((a) => a.athlete_id === me.id)}
          repMaxes={repMaxes.filter((r) => r.athlete_id === me.id)}
          canAward={false}
        />
      )}

      <PredictedHeightTool athlete={me} />





      {/* Assigned tests */}
      {myAssignments.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4" /> Tests to log
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {myAssignments.map((a) => {
              const meta = testTypeMeta(a.test_type);
              const done = isDone(a);
              const active = logFor === a.id;
              return (
                <div key={a.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{meta.label}</Badge>
                    <span className="text-xs text-muted-foreground">{a.scheduled_date}</span>
                    {done && <Badge className="ml-auto"><Check className="mr-1 h-3 w-3" /> Logged</Badge>}
                    {!done && !active && (
                      <Button size="sm" variant="outline" className="ml-auto"
                        onClick={() => { setLogFor(a.id); setLogValue(""); }}>
                        Log result
                      </Button>
                    )}
                  </div>
                  {a.notes && <div className="mt-1 text-xs text-muted-foreground">{a.notes}</div>}
                  {!done && active && (
                    <div className="mt-2 flex items-center gap-2">
                      <Input inputMode="decimal" placeholder={`Value (${meta.unit})`}
                        value={logValue} onChange={(e) => setLogValue(e.target.value)} className="h-9" />
                      <Button size="sm" onClick={() => logResult.mutate(a)} disabled={logResult.isPending}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setLogFor(null)}>Cancel</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}



      {/* Trend chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> My trend
          </CardTitle>
          {myTestTypes.length > 0 && metric && (
            <Select value={metric} onValueChange={setMetric}>
              <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {myTestTypes.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardHeader>
        <CardContent>
          {trend.points.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No test data yet. Once your coach logs a test, your trend will show up here.</p>
          ) : (
            <>
              <div className="mb-3 flex gap-4 text-sm">
                <div><span className="text-muted-foreground">Avg </span><span className="font-semibold">{avg?.toFixed(2)}</span> <span className="text-xs text-muted-foreground">{trend.meta.unit}</span></div>
                <div><span className="text-muted-foreground">Best </span><span className="font-semibold text-primary">{bestOverall}</span> <span className="text-xs text-muted-foreground">{trend.meta.unit}</span></div>
              </div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend.points} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" fontSize={11} />
                    <YAxis fontSize={11} domain={["auto", "auto"]} reversed={trend.meta.lowerIsBetter} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {avg != null && <ReferenceLine y={avg} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" label={{ value: "avg", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />}
                    <Line type="monotone" dataKey="value" name="Result" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="best" name="Personal best" stroke="hsl(var(--accent))" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Test results — Test / Result / Score / Team Rank, like a real testing report */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ListOrdered className="h-4 w-4" /> My Results</CardTitle></CardHeader>
        <CardContent className="p-0">
          {leaderboardRank.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No results ranked yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2 font-semibold">Test</th>
                    <th className="px-4 py-2 font-semibold">Result</th>
                    <th className="px-4 py-2 font-semibold">Score</th>
                    <th className="px-4 py-2 font-semibold">Team Rank</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leaderboardRank.map((r) => {
                    const top3 = r.rank <= 3;
                    return (
                      <tr key={r.type}>
                        <td className="px-4 py-2.5">
                          <div className="font-medium">{r.type}</div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">vs {r.scope}</div>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">{r.value} {r.unit}</td>
                        <td className="px-4 py-2.5 tabular-nums font-semibold">{r.score.toFixed(1)}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant={top3 ? "default" : "secondary"} className="tabular-nums">
                            #{r.rank} <span className="ml-1 opacity-70">of {r.of}</span>
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <TeamLeaderboardCard me={me} athletes={athletes} teams={teams} tests={tests} allTestTypeDefs={allTestTypeDefs} testTypeMeta={testTypeMeta} />

      <PinCard autoFocus={setupPin} />

      <div className="text-center">
        <Link to="/" className="text-xs text-muted-foreground hover:underline">Back to main site</Link>
      </div>
    </div>
  );
}

// Filterable, org-wide "who's at the top" board — a browsable counterpart to
// the personal "My Results" table above, matching the school-wide leaderboard
// coaches expect on a testing report.
function TeamLeaderboardCard({ me, athletes, teams, tests, allTestTypeDefs, testTypeMeta }: {
  me: Athlete;
  athletes: Athlete[];
  teams: Team[];
  tests: { athlete_id: string; test_type: string; value: number }[];
  allTestTypeDefs: { value: string; label: string; unit: string; lowerIsBetter: boolean }[];
  testTypeMeta: (v: string) => { label: string; unit: string; lowerIsBetter: boolean };
}) {
  const testTypesWithData = useMemo(() => {
    const withData = new Set(tests.map((t) => t.test_type));
    const defs = allTestTypeDefs.filter((d) => withData.has(d.value));
    return defs.length ? defs : allTestTypeDefs;
  }, [tests, allTestTypeDefs]);

  const [metric, setMetric] = useState<string>("");
  useEffect(() => {
    if (!metric && testTypesWithData.length) setMetric(testTypesWithData[0].value);
  }, [testTypesWithData, metric]);
  const [topN, setTopN] = useState("10");
  const [gender, setGender] = useState("all");
  const [sport, setSport] = useState(me.sport ?? "all");
  const [position, setPosition] = useState("all");

  const positions = useMemo(() => {
    const pool = sport === "all" ? athletes : athletes.filter((a) => (a.sport ?? "").toLowerCase() === sport.toLowerCase());
    return Array.from(new Set(pool.map((a) => a.position).filter((p): p is string => !!p))).sort();
  }, [athletes, sport]);

  const rows = useMemo(() => {
    if (!metric) return [];
    const meta = testTypeMeta(metric);
    const bestByAthlete = new Map<string, number>();
    for (const t of tests) {
      if (t.test_type !== metric) continue;
      const cur = bestByAthlete.get(t.athlete_id);
      if (cur == null || (meta.lowerIsBetter ? t.value < cur : t.value > cur)) bestByAthlete.set(t.athlete_id, t.value);
    }
    const pool = athletes.filter((a) => {
      if (gender !== "all" && (a.gender ?? "").toLowerCase() !== gender) return false;
      if (sport !== "all" && (a.sport ?? "").toLowerCase() !== sport.toLowerCase()) return false;
      if (position !== "all" && (a.position ?? "") !== position) return false;
      return bestByAthlete.has(a.id);
    });
    return pool
      .map((a) => ({ athlete: a, value: bestByAthlete.get(a.id)! }))
      .sort((a, b) => (meta.lowerIsBetter ? a.value - b.value : b.value - a.value))
      .slice(0, Number(topN));
  }, [metric, tests, athletes, gender, sport, position, topN, testTypeMeta]);

  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const meta = metric ? testTypeMeta(metric) : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Trophy className="h-4 w-4" /> Team Leaderboard</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Test" /></SelectTrigger>
            <SelectContent>
              {testTypesWithData.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={topN} onValueChange={setTopN}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["5", "10", "25"].map((n) => <SelectItem key={n} value={n}>Top {n}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={gender} onValueChange={setGender}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All genders</SelectItem>
              {GENDERS.map((g) => <SelectItem key={g} value={g}>{GENDER_LABELS[g]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sport} onValueChange={(v) => { setSport(v); setPosition("all"); }}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sports</SelectItem>
              {SPORTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {positions.length > 0 && (
          <Select value={position} onValueChange={setPosition}>
            <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All positions</SelectItem>
              {positions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No results yet for this test.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2 font-semibold">Rank</th>
                  <th className="px-2 py-2 font-semibold">Name</th>
                  <th className="px-2 py-2 font-semibold">Team</th>
                  <th className="px-2 py-2 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r, i) => (
                  <tr key={r.athlete.id} className={r.athlete.id === me.id ? "bg-primary/5" : undefined}>
                    <td className="px-2 py-2 font-semibold tabular-nums">{i + 1}</td>
                    <td className="px-2 py-2">
                      {athleteDisplayName(r.athlete)}
                      {r.athlete.id === me.id && <span className="ml-1.5 text-[10px] font-semibold uppercase text-primary">You</span>}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{teamById.get(r.athlete.team_id ?? "")?.name ?? "—"}</td>
                    <td className="px-2 py-2 tabular-nums">{r.value} {meta?.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PinCard({ autoFocus }: { autoFocus?: boolean }) {
  const setPin = useServerFn(setAthletePin);
  const getStatus = useServerFn(getMyPinStatus);
  const { data: status, refetch } = useQuery({
    queryKey: ["my-pin-status"],
    queryFn: () => getStatus(),
  });
  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInputRef.current?.focus();
    }, 300);
    return () => clearTimeout(t);
  }, [autoFocus]);

  const save = async () => {
    if (pin.length !== 6) return toast.error("PIN must be 6 digits");
    if (pin !== confirm) return toast.error("PINs don't match");
    setBusy(true);
    try {
      await setPin({ data: { pin } });
      toast.success(status?.hasPin ? "PIN updated" : "PIN set — you can now sign in with your PIN");
      setPinValue(""); setConfirm("");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save PIN");
    } finally { setBusy(false); }
  };

  return (
    <div ref={ref}>
      <Card className={autoFocus ? "ring-2 ring-primary animate-pulse" : undefined}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> {status?.hasPin ? "Change my PIN" : "Set a 6-digit PIN"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            A PIN lets you sign in fast with just your email + 6 digits. Keep it secret.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Input
              ref={firstInputRef}
              inputMode="numeric" maxLength={6} placeholder="New PIN"
              value={pin} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="text-center tracking-[0.5em]"
            />
            <Input
              inputMode="numeric" maxLength={6} placeholder="Confirm"
              value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="text-center tracking-[0.5em]"
            />
          </div>
          <Button onClick={save} disabled={busy || pin.length !== 6 || confirm.length !== 6} className="w-full">
            {busy ? "Saving…" : status?.hasPin ? "Update PIN" : "Save PIN"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}


function AthletePasswordAuth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em || !password) return toast.error("Enter email and password");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: em, password });
    setBusy(false);
    if (error) return toast.error(toUserMessage(error));
  };

  const forgot = async () => {
    const em = email.trim().toLowerCase();
    if (!em) return toast.error("Enter your email first");
    const { error } = await supabase.auth.resetPasswordForEmail(em, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return toast.error(toUserMessage(error));
    toast.success("Reset link sent — check your email");
  };

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Email</label>
            <Input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.edu" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Password</label>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "…" : "Sign in"}
          </Button>
        </form>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Invite-only access</span>
          <button type="button" className="text-muted-foreground hover:underline" onClick={forgot}>
            Forgot password?
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
