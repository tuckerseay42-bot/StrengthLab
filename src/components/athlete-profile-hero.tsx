import { useMemo } from "react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer, PolarRadiusAxis } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import type { Athlete, TestRow, AttendanceRow } from "@/lib/queries";

// -----------------------------------------------------------------------------
// Athlete performance profile — restrained palette:
//   • Athlete data: primary brand accent
//   • Peer baseline: muted neutral (dashed)
//   • Status colors reserved for meaningful state only
// Structure preserved from prior version; only visuals refined.
// -----------------------------------------------------------------------------

type MetricKey =
  | "speed"
  | "explosiveness"
  | "reactive_strength"
  | "upper_body"
  | "lower_body"
  | "relative_strength";

const METRIC_LABEL: Record<MetricKey, string> = {
  speed: "Speed",
  explosiveness: "Explosiveness",
  reactive_strength: "Reactive strength",
  upper_body: "Upper body",
  lower_body: "Lower body",
  relative_strength: "Relative strength",
};

const RADAR_ORDER: MetricKey[] = [
  "speed",
  "explosiveness",
  "reactive_strength",
  "upper_body",
  "lower_body",
  "relative_strength",
];

// Best value per athlete for a given test_type. `lowerIsBetter` flips comparison.
function bestPerAthlete(tests: TestRow[], testType: string, lowerIsBetter: boolean): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tests) {
    if (t.test_type !== testType || t.value == null) continue;
    const cur = m.get(t.athlete_id);
    if (cur == null || (lowerIsBetter ? t.value < cur : t.value > cur)) m.set(t.athlete_id, t.value);
  }
  return m;
}

// Percentile 0..100 of `val` among `pool` (population, self included).
function percentileOf(val: number, pool: number[], lowerIsBetter: boolean): number {
  if (!pool.length) return 0;
  const better = lowerIsBetter ? pool.filter((v) => v > val).length : pool.filter((v) => v < val).length;
  return Math.round((better / pool.length) * 100);
}

function safeDiv(a: number, b: number) { return b > 0 ? a / b : 0; }

// Percentile of `val` in a pool of relative-strength ratios (val / bodyweight).
function relativePercentile(
  athleteVal: number,
  athleteBw: number | null,
  poolAbs: Map<string, number>,
  poolBw: Map<string, number | null>,
): number {
  if (!athleteBw) {
    // Fall back to absolute percentile.
    return percentileOf(athleteVal, Array.from(poolAbs.values()), false);
  }
  const ratios: number[] = [];
  for (const [id, v] of poolAbs.entries()) {
    const bw = poolBw.get(id);
    if (bw) ratios.push(safeDiv(v, bw));
  }
  const mine = safeDiv(athleteVal, athleteBw);
  return percentileOf(mine, ratios, false);
}

type Row = { key: MetricKey; label: string; percentile: number | null };

export function AthleteProfileHero({
  athlete,
  athletes,
  tests,
  attendance,
}: {
  athlete: Athlete;
  athletes: Athlete[];
  tests: TestRow[];
  attendance: AttendanceRow[];
}) {
  // Peer pool: prefer same sport/gender/grade cohort, then team, then whole roster.
  const peers = useMemo(() => {
    const sameGender = athletes.filter((a) => (a.gender ?? null) === (athlete.gender ?? null));
    const cohort = sameGender.filter((a) => a.sport === athlete.sport && Math.abs((a.grade ?? 0) - (athlete.grade ?? 0)) <= 1);
    if (cohort.length >= 4) return cohort;
    const team = athletes.filter((a) => a.team_id === athlete.team_id);
    if (team.length >= 4) return team;
    return athletes;
  }, [athletes, athlete]);

  const peerIds = useMemo(() => new Set(peers.map((a) => a.id)), [peers]);
  const bwById = useMemo(() => new Map(peers.map((a) => [a.id, a.bodyweight] as const)), [peers]);

  // Filter tests to peer pool once.
  const peerTests = useMemo(() => tests.filter((t) => peerIds.has(t.athlete_id)), [tests, peerIds]);

  // Build percentile per metric.
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];

    const push = (key: MetricKey, percentile: number | null) =>
      out.push({ key, label: METRIC_LABEL[key], percentile });

    // SPEED — average of available sprint metrics (all lower-is-better).
    const speedParts: number[] = [];
    for (const type of ["sprint_10y", "sprint_40y", "pro_agility"]) {
      const best = bestPerAthlete(peerTests, type, true);
      const mine = best.get(athlete.id);
      if (mine != null) speedParts.push(percentileOf(mine, Array.from(best.values()), true));
    }
    push("speed", speedParts.length ? Math.round(speedParts.reduce((a, b) => a + b, 0) / speedParts.length) : null);

    // EXPLOSIVENESS — jump metrics.
    const jumpParts: number[] = [];
    for (const type of ["vertical_jump", "broad_jump"]) {
      const best = bestPerAthlete(peerTests, type, false);
      const mine = best.get(athlete.id);
      if (mine != null) jumpParts.push(percentileOf(mine, Array.from(best.values()), false));
    }
    push("explosiveness", jumpParts.length ? Math.round(jumpParts.reduce((a, b) => a + b, 0) / jumpParts.length) : null);

    // REACTIVE STRENGTH — RSI / ground-contact plyo metrics; average whichever are logged.
    const reactiveParts: number[] = [];
    for (const type of ["rsi", "reactive_strength_index", "ground_contact_time", "drop_jump_rsi"]) {
      const lower = type === "ground_contact_time";
      const best = bestPerAthlete(peerTests, type, lower);
      const mine = best.get(athlete.id);
      if (mine != null) reactiveParts.push(percentileOf(mine, Array.from(best.values()), lower));
    }
    push(
      "reactive_strength",
      reactiveParts.length ? Math.round(reactiveParts.reduce((a, b) => a + b, 0) / reactiveParts.length) : null,
    );

    // UPPER BODY STRENGTH — absolute bench 1RM.
    const benchBest = bestPerAthlete(peerTests, "bench_1rm", false);
    const mineBench = benchBest.get(athlete.id);
    push(
      "upper_body",
      mineBench != null ? percentileOf(mineBench, Array.from(benchBest.values()), false) : null,
    );

    // LOWER BODY STRENGTH — absolute squat 1RM, fall back to deadlift.
    const squatBest = bestPerAthlete(peerTests, "squat_1rm", false);
    const mineSquat = squatBest.get(athlete.id);
    if (mineSquat != null) {
      push("lower_body", percentileOf(mineSquat, Array.from(squatBest.values()), false));
    } else {
      const dlBest = bestPerAthlete(peerTests, "deadlift_1rm", false);
      const mine = dlBest.get(athlete.id);
      push("lower_body", mine != null ? percentileOf(mine, Array.from(dlBest.values()), false) : null);
    }

    // RELATIVE STRENGTH — best of bench/squat/deadlift per bodyweight, averaged.
    const relParts: number[] = [];
    for (const type of ["bench_1rm", "squat_1rm", "deadlift_1rm"]) {
      const best = bestPerAthlete(peerTests, type, false);
      const mine = best.get(athlete.id);
      if (mine != null) relParts.push(relativePercentile(mine, athlete.bodyweight, best, bwById));
    }
    push(
      "relative_strength",
      relParts.length ? Math.round(relParts.reduce((a, b) => a + b, 0) / relParts.length) : null,
    );

    return out;
  }, [peers, peerTests, athlete, bwById]);

  const standouts = useMemo(
    () => rows.filter((r) => r.percentile != null && r.percentile >= 80).sort((a, b) => (b.percentile! - a.percentile!)).slice(0, 2),
    [rows],
  );

  // Radar data (only include metrics we have a percentile for; use 0 fallback for missing to keep polygon closed).
  const radarData = useMemo(() => {
    return RADAR_ORDER.map((key) => {
      const r = rows.find((x) => x.key === key);
      return {
        axis: METRIC_LABEL[key],
        athlete: r?.percentile ?? 0,
        peers: 50, // dashed baseline = median
      };
    });
  }, [rows]);

  const overallProfile = useMemo(() => {
    const vals = rows.map((r) => r.percentile).filter((v): v is number => v != null);
    if (!vals.length) return 0;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [rows]);

  // Attendance stats
  const {
    heatCells, monthLabels, monthlyBars, totalSessions, thisYear, avgPerWeek, consistency,
  } = useAttendanceStats(attendance, athlete.id);

  return (
    <div className="space-y-4">
      {/* Performance profile card */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <div className="space-y-5">
              {/* Standouts */}
              <section>
                <SectionLabel>Where {athlete.first_name ?? "this athlete"} stands out</SectionLabel>
                {standouts.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Log a few tests to surface top-percentile strengths.
                  </p>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {standouts.map((s) => (
                      <div
                        key={s.key}
                        className="rounded-lg border border-border bg-muted/30 px-4 py-3"
                        style={{ borderLeft: "3px solid var(--status-pr)" }}
                      >
                        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {s.label}
                        </div>
                        <div className="mt-1 flex items-baseline gap-1.5">
                          <span className="stat-number text-3xl leading-none">{s.percentile}</span>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            percentile
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Performance bars */}
              <section>
                <SectionLabel>Performance profile</SectionLabel>
                <div className="mt-3 space-y-2">
                  {rows.map((r) => (
                    <BarRow key={r.key} label={r.label} value={r.percentile} />
                  ))}
                </div>
              </section>
            </div>

            {/* Radar */}
            <section className="flex flex-col">
              <SectionLabel>Percentile radar</SectionLabel>
              <div className="relative mt-2 h-[320px] sm:h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} outerRadius="72%">
                    <PolarGrid stroke="var(--color-border)" />
                    <PolarAngleAxis
                      dataKey="axis"
                      tick={(props: {
                        x: number;
                        y: number;
                        payload: { value: string };
                        textAnchor?: "start" | "middle" | "end" | "inherit";
                      }) => {
                        const { x, y, payload, textAnchor } = props;
                        return (
                          <text
                            x={x}
                            y={y}
                            textAnchor={textAnchor ?? "middle"}
                            fontSize={11}
                            fontWeight={600}
                            fill="var(--color-muted-foreground)"
                          >
                            {payload.value}
                          </text>
                        );
                      }}
                    />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar
                      name="Peer median"
                      dataKey="peers"
                      stroke="var(--color-muted-foreground)"
                      strokeDasharray="4 4"
                      strokeWidth={1}
                      fill="var(--color-muted-foreground)"
                      fillOpacity={0.04}
                    />
                    <Radar
                      name={athlete.first_name ?? "Athlete"}
                      dataKey="athlete"
                      stroke="var(--color-primary)"
                      fill="var(--color-primary)"
                      fillOpacity={0.18}
                      strokeWidth={2}
                      dot
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {/* Overall profile bar */}
              <div className="mt-3">
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-primary"
                    style={{ width: `${overallProfile}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span>0</span>
                  <span>Overall {overallProfile} / 100</span>
                  <span>100</span>
                </div>
              </div>
            </section>
          </div>
        </CardContent>
      </Card>

      {/* Attendance card */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <SectionLabel>Attendance</SectionLabel>
              <div className="mt-1 text-xs text-muted-foreground">
                <span className="stat-number text-foreground">{totalSessions}</span> sessions ·{" "}
                {heatCells.filter((c) => c.count > 0).length} days active in the last nine months
              </div>
            </div>
            <div className="hidden items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground sm:flex">
              Less
              <span className="h-2.5 w-2.5 rounded-sm bg-muted" />
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: "color-mix(in oklab, var(--color-primary) 45%, transparent)" }}
              />
              <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
              More
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {/* Heatmap */}
            <div className="overflow-x-auto">
              <div className="min-w-[520px]">
                <div className="mb-1 flex justify-between px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {monthLabels.map((m, i) => (
                    <span key={i}>{m}</span>
                  ))}
                </div>
                <div className="flex gap-[3px]">
                  {heatCells
                    .reduce<Array<Array<(typeof heatCells)[number]>>>((cols, cell, i) => {
                      const col = Math.floor(i / 7);
                      cols[col] = cols[col] ?? [];
                      cols[col].push(cell);
                      return cols;
                    }, [])
                    .map((col, ci) => (
                      <div key={ci} className="flex flex-col gap-[3px]">
                        {col.map((c, ri) => (
                          <div
                            key={ri}
                            title={`${c.date} — ${c.count} session${c.count === 1 ? "" : "s"}`}
                            className="h-2.5 w-2.5 rounded-[2px]"
                            style={{ background: heatColor(c.count) }}
                          />
                        ))}
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Right column: monthly bars + summary stats */}
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Last 6 months
                </div>
                <div className="flex h-16 items-end gap-2">
                  {monthlyBars.map((m, i) => {
                    const max = Math.max(1, ...monthlyBars.map((x) => x.count));
                    const h = m.count > 0 ? Math.max(6, Math.round((m.count / max) * 60)) : 2;
                    return (
                      <div key={i} className="flex flex-1 flex-col items-center gap-1">
                        <div
                          className="w-full rounded-sm bg-primary"
                          style={{ height: `${h}px`, opacity: m.count > 0 ? 1 : 0.15 }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-1 flex gap-2">
                  {monthlyBars.map((m, i) => (
                    <div
                      key={i}
                      className="flex-1 text-center text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      {m.label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 border-t border-border pt-3">
                <Stat label="Total" value={String(totalSessions)} />
                <Stat label="This year" value={String(thisYear)} />
                <Stat label="Avg / wk" value={avgPerWeek.toFixed(1)} />
                <Stat label="Consistency" value={`${consistency}%`} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function BarRow({ label, value }: { label: string; value: number | null }) {
  const pct = value ?? 0;
  return (
    <div className="grid grid-cols-[minmax(120px,160px)_1fr_36px] items-center gap-3">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all"
          style={{ width: `${pct}%`, opacity: value == null ? 0 : 1 }}
        />
      </div>
      <div className="stat-number text-right text-sm tabular-nums text-foreground">
        {value == null ? "—" : value}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="stat-number truncate text-base text-foreground">{value}</div>
    </div>
  );
}

function heatColor(count: number): string {
  if (count <= 0) return "var(--color-muted)";
  if (count === 1) return "color-mix(in oklab, var(--color-primary) 30%, transparent)";
  if (count === 2) return "color-mix(in oklab, var(--color-primary) 60%, transparent)";
  return "var(--color-primary)";
}


function useAttendanceStats(attendance: AttendanceRow[], athleteId: string) {
  return useMemo(() => {
    const mine = attendance.filter((a) => a.athlete_id === athleteId && a.present);
    const bySession = new Map<string, number>();
    for (const a of mine) bySession.set(a.session_date, (bySession.get(a.session_date) ?? 0) + 1);

    // 9-month heatmap: 273 days back, aligned to Sunday-start weeks (~40 columns × 7 rows).
    const today = new Date();
    const end = new Date(today);
    const start = new Date(today); start.setDate(start.getDate() - 273);
    // Snap start back to previous Sunday.
    start.setDate(start.getDate() - start.getDay());

    const cells: { date: string; count: number }[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      cells.push({ date: key, count: bySession.get(key) ?? 0 });
    }

    // Month labels across the columns.
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const monthLabels: string[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < cells.length; i += 28) {
      const d = new Date(cells[i].date);
      const m = d.getMonth();
      if (!seen.has(m)) { seen.add(m); monthLabels.push(months[m].toUpperCase()); }
    }

    // Monthly bars — last 6 calendar months including current.
    const monthlyBars: { label: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const label = months[d.getMonth()].toUpperCase();
      let count = 0;
      for (const c of cells) {
        const cd = new Date(c.date);
        if (cd.getFullYear() === d.getFullYear() && cd.getMonth() === d.getMonth()) count += c.count;
      }
      monthlyBars.push({ label, count });
    }

    // Summary stats — use ALL athlete attendance (not just windowed).
    const allPresent = attendance.filter((a) => a.athlete_id === athleteId && a.present);
    const totalSessions = allPresent.length;
    const thisYear = allPresent.filter((a) => a.session_date.startsWith(String(today.getFullYear()))).length;

    // Avg per week over last 12 weeks with any session.
    const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 84);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    const recent = allPresent.filter((a) => a.session_date >= cutoffKey).length;
    const avgPerWeek = recent / 12;

    // Consistency = present / total logged sessions for this athlete.
    const allMine = attendance.filter((a) => a.athlete_id === athleteId);
    const consistency = allMine.length ? Math.round((allPresent.length / allMine.length) * 100) : 0;

    return { heatCells: cells, monthLabels, monthlyBars, totalSessions, thisYear, avgPerWeek, consistency };
  }, [attendance, athleteId]);
}
