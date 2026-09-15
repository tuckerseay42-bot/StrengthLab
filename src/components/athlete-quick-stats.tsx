// Athlete Quick Stats — hero + weekly load + best-exercise trend line.
// Uses existing lifts/tests data; renders in Graphite/Steel/Chalk + Bar Blue
// with neon accent for PR moments. No solid stock-bar charts; area gradients
// + smooth curves + subtle gridlines only.

import { useMemo } from "react";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowDownRight, ArrowUpRight, Flame, Dumbbell, Activity, Calendar, Layers, Zap } from "lucide-react";
import type { Athlete, LiftRow, AttendanceRow } from "@/lib/queries";
import { athleteDisplayName } from "@/lib/queries";
import { useUnitPrefs } from "@/hooks/use-units";
import { fromLb } from "@/lib/units";

type Props = {
  athlete: Athlete;
  lifts: LiftRow[];
  attendance: AttendanceRow[];
};

/** Sunday-start ISO week key */
function weekKey(d: Date): string {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  x.setUTCDate(x.getUTCDate() - x.getUTCDay());
  return x.toISOString().slice(0, 10);
}

function daysBetween(from: string | Date, to: Date = new Date()): number {
  const a = typeof from === "string" ? new Date(from) : from;
  return Math.max(0, Math.floor((+to - +a) / 86400000));
}

export function AthleteQuickStats({ athlete, lifts, attendance }: Props) {
  const [prefs, setPrefs] = useUnitPrefs();
  const unit = prefs.weight; // "lb" | "kg"
  const conv = (lb: number | null | undefined) =>
    lb == null ? null : Math.round(fromLb(lb, unit) * 10) / 10;

  const myLifts = useMemo(
    () => lifts.filter((l) => l.athlete_id === athlete.id),
    [lifts, athlete.id],
  );
  const myAtt = useMemo(
    () => attendance.filter((a) => a.athlete_id === athlete.id),
    [attendance, athlete.id],
  );

  // ---- Weekly load buckets (Σ load × reps) ----
  const weekly = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of myLifts) {
      if (l.load == null || l.reps == null) continue;
      const wk = weekKey(new Date(l.lift_date));
      map.set(wk, (map.get(wk) ?? 0) + Number(l.load) * Number(l.reps));
    }
    const sorted = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    const last12 = sorted.slice(-12);
    return last12.map(([wk, v]) => ({
      wk,
      label: `W${new Date(wk).toISOString().slice(5, 10)}`,
      load: Math.round(fromLb(v, unit)),
    }));
  }, [myLifts, unit]);

  // ---- Sessions per week / average ----
  const sessionsPerWeek = useMemo(() => {
    const wk = new Map<string, Set<string>>();
    for (const l of myLifts) {
      const k = weekKey(new Date(l.lift_date));
      const s = wk.get(k) ?? new Set();
      s.add(l.lift_date);
      wk.set(k, s);
    }
    return [...wk.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([k, s]) => ({ wk: k, sessions: s.size }));
  }, [myLifts]);

  const thisWeekSessions = sessionsPerWeek.length
    ? sessionsPerWeek[sessionsPerWeek.length - 1].sessions
    : 0;
  const avgSessions = sessionsPerWeek.length
    ? Math.round(sessionsPerWeek.reduce((a, b) => a + b.sessions, 0) / sessionsPerWeek.length)
    : 0;

  // ---- 4-wk load trend ----
  const trendPct = useMemo(() => {
    if (weekly.length < 2) return 0;
    const last4 = weekly.slice(-4).reduce((a, b) => a + b.load, 0);
    const prev4 = weekly.slice(-8, -4).reduce((a, b) => a + b.load, 0);
    if (!prev4) return 0;
    return Math.round(((last4 - prev4) / prev4) * 100);
  }, [weekly]);

  // ---- Featured / most-recent PR ----
  const featured = useMemo(() => {
    // Best-per-exercise timeline; the most recent lift that set a new PR wins.
    const bestSoFar = new Map<string, number>();
    let pr: LiftRow | null = null;
    const chrono = [...myLifts].sort((a, b) => a.lift_date.localeCompare(b.lift_date));
    for (const l of chrono) {
      if (l.load == null) continue;
      const cur = bestSoFar.get(l.exercise) ?? 0;
      if (l.load > cur) {
        bestSoFar.set(l.exercise, Number(l.load));
        pr = l;
      }
    }
    return pr;
  }, [myLifts]);

  // ---- Stat tiles ----
  const totalSessions = useMemo(() => {
    const set = new Set(myLifts.map((l) => l.lift_date));
    return set.size;
  }, [myLifts]);
  const totalLoadLb = useMemo(
    () => myLifts.reduce((s, l) => s + (l.load && l.reps ? Number(l.load) * Number(l.reps) : 0), 0),
    [myLifts],
  );
  const allTimeMax = useMemo(() => {
    let best: { load: number; exercise: string } | null = null;
    for (const l of myLifts) {
      if (l.load == null) continue;
      if (!best || l.load > best.load) best = { load: Number(l.load), exercise: l.exercise };
    }
    return best;
  }, [myLifts]);
  const uniqueExercises = useMemo(
    () => new Set(myLifts.map((l) => l.exercise)).size,
    [myLifts],
  );
  const lastWorkoutDate = myLifts.length
    ? [...myLifts].sort((a, b) => b.lift_date.localeCompare(a.lift_date))[0].lift_date
    : null;
  const daysSince = lastWorkoutDate ? daysBetween(lastWorkoutDate) : null;

  // ---- Featured exercise line series (top volume exercise) ----
  const featuredExercise = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of myLifts) counts.set(l.exercise, (counts.get(l.exercise) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [myLifts]);

  const trendSeries = useMemo(() => {
    if (!featuredExercise) return [];
    const byDate = new Map<string, number>();
    for (const l of myLifts) {
      if (l.exercise !== featuredExercise || l.load == null) continue;
      const cur = byDate.get(l.lift_date) ?? 0;
      byDate.set(l.lift_date, Math.max(cur, Number(l.load)));
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, load]) => ({ date, load: Math.round(fromLb(load, unit) * 10) / 10 }));
  }, [myLifts, featuredExercise, unit]);

  const rising = trendPct >= 0;

  const initials = (athleteDisplayName(athlete) || "?")
    .split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase();

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="card-elevated">
        <CardContent className="p-4 sm:p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-semibold"
                style={{
                  background: "color-mix(in oklab, var(--neon-primary) 22%, var(--card))",
                  color: "var(--foreground)",
                  boxShadow: "0 0 0 1px color-mix(in oklab, var(--neon-primary) 40%, transparent)",
                }}
              >
                {athlete.photo_url ? (
                  <img src={athlete.photo_url} alt="" className="h-full w-full rounded-full object-cover" />
                ) : initials}
              </div>
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold leading-tight">{athleteDisplayName(athlete)}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {daysSince == null
                    ? "No sessions logged"
                    : daysSince === 0
                      ? "Trained today"
                      : `${daysSince}d since last session`}
                </div>
              </div>
            </div>
            <div className="inline-flex shrink-0 rounded-md border border-border p-0.5">
              {(["kg", "lb"] as const).map((u) => (
                <button
                  key={u}
                  onClick={() => setPrefs({ weight: u })}
                  className={`h-8 min-w-12 rounded-sm px-2 text-xs font-semibold uppercase tracking-wider transition ${
                    unit === u
                      ? "bg-primary text-primary-foreground shadow-[0_0_16px_-4px_var(--neon-primary)]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          {/* Hero row: sessions this week + load trend */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <HeroStat
              label="Sessions this week"
              value={thisWeekSessions}
              sub={`avg ${avgSessions}/wk`}
              tint="primary"
              icon={<Activity className="h-4 w-4" />}
            />
            <HeroStat
              label="Load trend (4-wk)"
              value={`${rising ? "↑" : "↓"} ${Math.abs(trendPct)}%`}
              sub="vs. prior 4 weeks"
              tint={rising ? "success" : "warn"}
              icon={rising ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
            />
          </div>

          {/* Featured PR / most recent lift */}
          {featured && (
            <div className="mt-4 overflow-hidden rounded-xl border border-border bg-[color-mix(in_oklab,var(--neon-accent)_10%,var(--card))] p-4 neon-ring-accent">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="eyebrow">Featured PR</div>
                  <div className="mt-1 truncate text-xl font-semibold">{featured.exercise}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {featured.lift_date} · {featured.reps ?? 1} rep{(featured.reps ?? 1) > 1 ? "s" : ""}
                    {featured.velocity != null ? ` · ${featured.velocity} m/s` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="stat-number text-3xl tabular-nums" style={{ color: "var(--neon-accent)" }}>
                    {conv(featured.load)}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{unit}</div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <StatTile accent="primary"  eyebrow="Total sessions"  value={totalSessions.toLocaleString()} sub={lastWorkoutDate ? `since ${lastWorkoutDate}` : "—"} icon={<Calendar className="h-4 w-4" />} />
        <StatTile accent="accent"   eyebrow={`Total load (${unit})`} value={Math.round(fromLb(totalLoadLb, unit)).toLocaleString()} sub={`${unit} × reps`} icon={<Zap className="h-4 w-4" />} />
        <StatTile accent="success"  eyebrow={`All-time max`} value={allTimeMax ? String(conv(allTimeMax.load) ?? "—") : "—"} sub={allTimeMax ? `${unit} · ${allTimeMax.exercise}` : "no lifts"} icon={<Dumbbell className="h-4 w-4" />} />
        <StatTile accent="warn"     eyebrow="Exercises logged" value={uniqueExercises.toString()} sub="unique movements" icon={<Layers className="h-4 w-4" />} />
        <StatTile accent="muted"    eyebrow="Last workout" value={lastWorkoutDate ?? "—"} sub={daysSince != null ? `${daysSince}d ago` : "—"} icon={<Flame className="h-4 w-4" />} />
      </div>

      {/* Weekly training load — gradient area */}
      <Card className="card-elevated">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="eyebrow">Weekly training load</div>
              <div className="mt-0.5 text-sm text-muted-foreground">Last {weekly.length} weeks · {unit} × reps</div>
            </div>
          </div>
          {weekly.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">No lifts logged yet.</p>
          ) : (
            <div className="mt-4 h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weekly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="qsLoad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"  stopColor="var(--neon-primary)" stopOpacity={0.55} />
                      <stop offset="60%" stopColor="var(--neon-primary)" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="var(--neon-primary)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip content={<DarkTooltip unit={unit} />} cursor={{ stroke: "var(--neon-primary)", strokeOpacity: 0.35 }} />
                  <Area type="monotone" dataKey="load" stroke="var(--neon-primary)" strokeWidth={2.2} fill="url(#qsLoad)"
                    style={{ filter: "drop-shadow(0 0 8px color-mix(in oklab, var(--neon-primary) 45%, transparent))" }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Featured exercise — max over time */}
      {featuredExercise && trendSeries.length >= 2 && (
        <Card className="card-elevated">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="eyebrow">{featuredExercise} — max over time</div>
                <div className="mt-0.5 text-sm text-muted-foreground">{trendSeries.length} sessions · {unit}</div>
              </div>
            </div>
            <div className="mt-4 h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendSeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="qsLine" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%"   stopColor="var(--neon-accent)"  stopOpacity={0.9} />
                      <stop offset="100%" stopColor="var(--neon-primary)" stopOpacity={1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 6" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis domain={["auto", "auto"]} tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip content={<DarkTooltip unit={unit} label={featuredExercise} />} cursor={{ stroke: "var(--neon-primary)", strokeOpacity: 0.35 }} />
                  <Line
                    type="monotone"
                    dataKey="load"
                    stroke="url(#qsLine)"
                    strokeWidth={2.5}
                    dot={{ r: 3, stroke: "var(--neon-primary)", strokeWidth: 1.5, fill: "var(--card)" }}
                    activeDot={{ r: 5, stroke: "var(--neon-accent)", strokeWidth: 2, fill: "var(--neon-accent)" }}
                    style={{ filter: "drop-shadow(0 0 6px color-mix(in oklab, var(--neon-primary) 55%, transparent))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {myAtt.length === -1 && <span />}
    </div>
  );
}

/* ---------- pieces ---------- */

function HeroStat({
  label, value, sub, tint, icon,
}: {
  label: string; value: string | number; sub?: string;
  tint: "primary" | "success" | "warn"; icon: React.ReactNode;
}) {
  const color =
    tint === "success" ? "var(--status-pr)"
    : tint === "warn"  ? "var(--status-near)"
    : "var(--neon-primary)";
  return (
    <div
      className="rounded-xl border border-border bg-card p-4"
      style={{ boxShadow: `inset 0 1px 0 0 color-mix(in oklab, ${color} 20%, transparent)` }}
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        <span style={{ color }}>{icon}</span> {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="stat-number text-3xl tabular-nums" style={{ color }}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

function StatTile({
  accent, eyebrow, value, sub, icon,
}: {
  accent: "primary" | "accent" | "success" | "warn" | "muted";
  eyebrow: string; value: string; sub?: string; icon?: React.ReactNode;
}) {
  const color =
    accent === "primary" ? "var(--neon-primary)"
    : accent === "accent" ? "var(--neon-accent)"
    : accent === "success" ? "var(--status-pr)"
    : accent === "warn" ? "var(--status-near)"
    : "var(--muted-foreground)";
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-3">
      <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: color, boxShadow: `0 0 12px 0 ${color}` }} />
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {icon && <span style={{ color }}>{icon}</span>} {eyebrow}
      </div>
      <div className="mt-1 stat-number truncate text-2xl tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function DarkTooltip({
  active, payload, label, unit,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: { date?: string; label?: string; wk?: string } }>;
  label?: string; unit: string;
}) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  const stamp = p.payload.date ?? p.payload.wk ?? p.payload.label ?? label ?? "";
  return (
    <div
      className="rounded-md border px-3 py-2 text-xs shadow-lg"
      style={{
        background: "var(--color-popover)",
        borderColor: "color-mix(in oklab, var(--neon-primary) 40%, var(--color-border))",
        color: "var(--color-popover-foreground)",
        boxShadow: "0 8px 24px -8px color-mix(in oklab, var(--neon-primary) 40%, transparent)",
      }}
    >
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{stamp}</div>
      <div className="mt-0.5 stat-number text-base tabular-nums" style={{ color: "var(--neon-primary)" }}>
        {p.value.toLocaleString()} <span className="text-[10px] font-normal uppercase text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}
