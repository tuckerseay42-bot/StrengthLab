// Shared "paper report" GPS components used by the public GPS Report Builder
// (/reports/gps-report) and the in-app GPS tool (/gps).
import { useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from "recharts";
import { Download } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  BOARD_METRICS, GPS_METRICS, loadStatus, statusLabel, summarize,
  type BoardMetricKey, type GpsMetricKey, type LoadStatus,
} from "@/lib/gps";
import { boardEntries, boardMetricAvailable, type GpsReportRow } from "@/lib/gps-report";
import { latestEffortVerdict, combinedEffort } from "@/lib/gps-effort";

export const digitsFor = (k: BoardMetricKey) => (k === "sprint_count" || k === "sprint_yards" || k === "combined_effort" || k === "loaf" ? 0 : 2);
export const show = (v: number | null | undefined, d: number) => (v == null ? "—" : Number(v).toFixed(d));

/** Combined accel + decel effort for the latest session, vs. that weekday's average. */
export function EffortRow({ rows, className }: { rows: GpsReportRow[]; className?: string }) {
  const v = latestEffortVerdict(rows);
  if (!v || v.kind === "none") return null;
  return (
    <div className={cn("mt-3 rounded-lg border border-paper-border bg-paper-subtle px-3 py-2.5", className)}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3">
        <span className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-paper-muted">
          Combined efforts · accel + decel
        </span>
        <span className="font-display text-[15px] font-semibold tabular-nums leading-none">{v.total ?? "—"}</span>
        <span className="text-[10.5px] tabular-nums text-paper-muted">
          {v.weekday.slice(0, 3)} avg {v.weekdayAvg == null ? "—" : v.weekdayAvg.toFixed(1)}
        </span>
      </div>
      <div
        className={cn(
          "mt-1.5 text-[11.5px] font-medium leading-tight",
          v.kind === "loaf" && "text-paper-warm",
          v.kind === "harder" && "text-paper-good",
          v.kind === "no-history" && "text-paper-muted",
        )}
      >
        {v.message}
      </div>
    </div>
  );
}


/** Combined accel + decel efforts per minute for the latest session. */
export function EffortRateRow({
  rows, practiceMinutes, className,
}: { rows: GpsReportRow[]; practiceMinutes?: number | null; className?: string }) {
  const mins = practiceMinutes && practiceMinutes > 0 ? practiceMinutes : null;
  const last = rows[rows.length - 1];
  const efforts = last ? combinedEffort(last) : null;
  if (!mins || efforts == null) return null;
  return (
    <div className={cn("mt-2 rounded-lg border border-paper-border bg-paper-subtle px-3 py-2.5", className)}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
        <span className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-paper-muted">
          Efforts per minute · accel + decel ÷ practice time
        </span>
        <span className="font-display text-[15px] font-semibold tabular-nums leading-none">
          {(efforts / mins).toFixed(2)}
        </span>
      </div>
      <div className="mt-1 text-[10.5px] tabular-nums text-paper-muted">
        {efforts} combined efforts over {mins} min
      </div>
    </div>
  );
}

/** Team bests, used for the mini percentile bars on each card. */
export function teamMaxes(rows: GpsReportRow[]) {
  const out = {} as Record<GpsMetricKey, number>;
  for (const m of GPS_METRICS) {
    const vals = rows.map((r) => r[m.key]).filter((v): v is number => v != null);
    out[m.key] = vals.length ? Math.max(...vals) : 0;
  }
  return out;
}

export function PaperStat({
  label, value, sub, className,
}: { label: string; value: string; sub: string; className?: string }) {
  return (
    <div className={cn("bg-paper px-3 py-3.5", className)}>
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-paper-muted">{label}</div>
      <div className="mt-1 font-display text-[22px] font-semibold leading-none tabular-nums">{value}</div>
      <div className="mt-1.5 text-[11px] leading-tight text-paper-muted">{sub}</div>
    </div>
  );
}

/** Explains the load-status badges and the flags counter. */
export function LoadLegend({ onRef }: { onRef?: (el: HTMLElement | null) => void }) {
  const items = [
    {
      key: "high",
      label: "High",
      cls: "bg-paper-danger/12 text-paper-danger",
      text: "Today was meaningfully harder than this athlete's normal session — a workload spike worth monitoring for fatigue or soreness.",
    },
    {
      key: "normal",
      label: "Normal",
      cls: "bg-paper-good/12 text-paper-good",
      text: "Today's work sits right around their usual session — training is tracking as expected.",
    },
    {
      key: "low",
      label: "Low",
      cls: "bg-paper-warm/15 text-paper-warm",
      text: "Today was lighter than their normal session — a planned light day, modified work, or a partial session.",
    },
  ];
  return (
    <div ref={onRef} className="mt-4 rounded-xl border border-paper-border bg-paper-subtle px-4 py-3.5">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-paper-muted">
        How to read the load status
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-paper-muted">
        Each athlete's badge compares their most recent session's <strong className="font-semibold text-paper-foreground">player load</strong> to
        their own average across the sessions in this file, then reports only the resulting band — High, Normal or
        Low — instead of a raw number. <strong className="font-semibold text-paper-foreground">Flags</strong> above simply counts how many athletes landed
        in the high and low bands today.
      </p>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        {items.map((i) => (
          <div key={i.key} className="rounded-lg bg-paper px-3 py-2.5">
            <dt>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]", i.cls)}>
                {i.label}
              </span>
            </dt>
            <dd className="mt-1.5 text-[11.5px] leading-relaxed text-paper-muted">{i.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function AthleteReportCard({
  name, rows, teamMax, practiceMinutes, onRef, onDownloadCard, className,
}: {
  name: string;
  rows: GpsReportRow[];
  teamMax: Record<GpsMetricKey, number>;
  /** Practice duration in minutes — enables the efforts-per-minute readout. */
  practiceMinutes?: number | null;
  onRef?: (el: HTMLElement | null) => void;
  onDownloadCard?: () => void;
  className?: string;
}) {
  const load = summarize(rows as never, "player_load");
  const { status } = loadStatus(load.today, load.average);
  // Trend graph shows only the athlete's most recent 7 days of sessions.
  const last = rows[rows.length - 1]?.session_date ?? null;
  const chartRows = (() => {
    if (!last) return rows;
    const cutoff = new Date(`${last}T00:00:00`);
    cutoff.setDate(cutoff.getDate() - 6);
    const iso = cutoff.toISOString().slice(0, 10);
    const windowed = rows.filter((r) => r.session_date >= iso);
    return windowed.length ? windowed : rows.slice(-7);
  })();

  // Per-day load status so the chart line/fill fades between green, red, and yellow.
  const windowLoads = chartRows.map((r) => r.player_load).filter((v): v is number => v != null);
  const windowAvg = windowLoads.length ? windowLoads.reduce((a, b) => a + b, 0) / windowLoads.length : null;
  const chart = chartRows.map((r) => ({
    d: r.session_date.slice(5),
    v: r.player_load ?? 0,
    status: loadStatus(r.player_load, windowAvg).status,
  }));
  const id = `g-${name.replace(/\W+/g, "")}`;
  const statusColor = (s: LoadStatus) => {
    if (s === "high") return "var(--paper-danger)";
    if (s === "low") return "var(--paper-warm)";
    return "var(--paper-good)";
  };

  return (
    <article ref={onRef} className={cn("break-inside-avoid rounded-xl border border-paper-border bg-paper p-4 text-paper-foreground", className)}>
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-bold tracking-tight">{name}</h3>
          <div className="text-[11px] text-paper-muted">{rows.length} session{rows.length === 1 ? "" : "s"} recorded</div>
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-paper-accent">Single-session practice summary</div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
              status === "high" && "bg-paper-danger/12 text-paper-danger",
              status === "normal" && "bg-paper-good/12 text-paper-good",
              status === "low" && "bg-paper-warm/15 text-paper-warm",
              status === "none" && "bg-paper-subtle text-paper-muted",
            )}
          >
            {statusLabel(status)}
          </span>
          {onDownloadCard && (
            <button
              type="button"
              onClick={() => void onDownloadCard()}
              data-export-hide
              className="rounded-md p-1.5 text-paper-muted transition-colors hover:bg-paper-subtle hover:text-paper-foreground print:hidden"
              aria-label="Download card"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <div className="mt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-paper-muted">
        Player load · last 7 days
      </div>
      <div className="mt-1 h-24">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={{ left: 0, right: 6, top: 6, bottom: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
                {chart.map((p, i) => {
                  const offset = chart.length <= 1 ? 0 : (i / (chart.length - 1)) * 100;
                  return <stop key={i} offset={`${offset}%`} stopColor={statusColor(p.status)} stopOpacity={0.25} />;
                })}
              </linearGradient>
              <linearGradient id={`${id}-stroke`} x1="0" y1="0" x2="1" y2="0">
                {chart.map((p, i) => {
                  const offset = chart.length <= 1 ? 0 : (i / (chart.length - 1)) * 100;
                  return <stop key={i} offset={`${offset}%`} stopColor={statusColor(p.status)} stopOpacity={1} />;
                })}
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="currentColor" className="text-paper-border" />
            <XAxis dataKey="d" tick={{ fontSize: 10 }} stroke="currentColor" className="text-paper-muted" tickLine={false} axisLine={false} />
            <YAxis
              tick={{ fontSize: 10 }}
              stroke="currentColor"
              className="text-paper-muted"
              tickLine={false}
              axisLine={false}
              width={38}
              tickCount={3}
              tickFormatter={(v: number) => Math.round(v).toString()}
            />
            <RTooltip
              contentStyle={{ background: "var(--paper)", border: "1px solid var(--paper-border)", borderRadius: 8, fontSize: 12, color: "var(--paper-foreground)" }}
              labelStyle={{ color: "var(--paper-muted)" }}
            />
            <Area
              type="monotone"
              dataKey="v"
              name="Player load"
              strokeWidth={2}
              stroke={`url(#${id}-stroke)`}
              fill={`url(#${id})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <EffortRow rows={rows} />
      <EffortRateRow rows={rows} practiceMinutes={practiceMinutes} />

      <div className="mt-4 space-y-2.5">

        {GPS_METRICS.map((m) => {
          const s = summarize(rows as never, m.key);
          const d = digitsFor(m.key);
          const pct = teamMax[m.key] && s.today != null ? Math.min(100, (s.today / teamMax[m.key]) * 100) : 0;
          return (
            <div key={m.key}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
                <span className="truncate text-[11px] font-medium tracking-[0.02em] text-paper-muted">
                  {m.label}{m.unit ? <span className="text-paper-border"> · {m.unit}</span> : null}
                </span>
                <span className="shrink-0 font-display text-[15px] font-semibold tabular-nums leading-none">
                  {show(s.today, d)}
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-paper-subtle">
                <div className="h-full rounded-full bg-paper-accent" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 text-[10.5px] tabular-nums text-paper-muted">
                avg {show(s.average, d)} · max {show(s.max, d)}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

/** Best athletes for any GPS metric within the selected window. */
export type BoardRange = "day" | "week" | "all";

export function SpeedLeaderboard({
  rows, limit, onLimitChange, onRef, metric = "top_speed", onMetricChange,
}: {
  rows: GpsReportRow[];
  limit: number;
  onLimitChange: (n: number) => void;
  onRef?: (el: HTMLElement | null) => void;
  metric?: BoardMetricKey;
  onMetricChange?: (k: BoardMetricKey) => void;
}) {
  const [range, setRange] = useState<BoardRange>("all");

  const available = useMemo(
    () => BOARD_METRICS.filter((m) => boardMetricAvailable(rows, m.key)),
    [rows],
  );
  const meta = BOARD_METRICS.find((m) => m.key === metric) ?? BOARD_METRICS[0];
  const d = digitsFor(metric);

  const { board, windowLabel } = useMemo(() => {
    const dates = Array.from(new Set(rows.map((r) => r.session_date))).sort();
    const latest = dates[dates.length - 1];
    let keep = (_d: string) => true as boolean;
    let label = dates.length > 1 ? `${dates[0]} → ${latest}` : (latest ?? "");
    if (range === "day" && latest) {
      keep = (d) => d === latest;
      label = latest;
    } else if (range === "week" && latest) {
      const start = new Date(`${latest}T00:00:00`);
      start.setDate(start.getDate() - 6);
      const from = start.toISOString().slice(0, 10);
      keep = (d) => d >= from && d <= latest;
      label = `${from} → ${latest}`;
    }
    return {
      board: boardEntries(rows, metric, keep),
      windowLabel: label,
    };
  }, [rows, range, metric]);

  if (!board.length) return null;
  const shown = board.slice(0, Math.max(1, Math.min(limit, board.length)));
  const top = shown[0].mph;
  const rangeTitle = range === "day" ? "Daily" : range === "week" ? "Weekly" : "All-time";

  return (
    <section ref={onRef} className="mt-4 break-inside-avoid rounded-xl border border-paper-border bg-paper px-4 py-4 text-paper-foreground">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-paper-muted">
            {meta.label}{meta.unit ? ` · ${meta.unit}` : ""}
          </div>
          <div className="mt-0.5 font-display text-lg font-bold tracking-tight">
            {rangeTitle} leaderboard
          </div>
          <div className="mt-0.5 text-[11px] tabular-nums text-paper-muted">
            {windowLabel} · top {shown.length} of {board.length}
          </div>
        </div>
        <div
          className="grid w-full min-w-0 grid-cols-2 gap-2 print:hidden sm:flex sm:w-auto sm:shrink-0 sm:flex-wrap sm:items-center"
          data-export-hide
        >
          {onMetricChange && available.length > 1 && (
            <select
              value={metric}
              onChange={(e) => onMetricChange(e.target.value as BoardMetricKey)}
              className="col-span-2 h-9 w-full min-w-0 rounded-md border border-paper-border bg-paper-subtle px-2 text-[12px] text-paper-foreground outline-none sm:h-8 sm:w-auto"
            >
              {available.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          )}
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as BoardRange)}
            className="h-9 w-full min-w-0 rounded-md border border-paper-border bg-paper-subtle px-2 text-[12px] text-paper-foreground outline-none sm:h-8 sm:w-auto"
          >
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="all">All-time</option>
          </select>
          <select
            value={String(limit)}
            onChange={(e) => onLimitChange(Number(e.target.value))}
            className="h-9 w-full min-w-0 rounded-md border border-paper-border bg-paper-subtle px-2 text-[12px] text-paper-foreground outline-none sm:h-8 sm:w-auto"
          >
            {Array.from(new Set([3, 5, 10, 15, 20, 25].filter((n) => n < board.length).concat(board.length))).map((n) => (
              <option key={n} value={n}>{n === board.length ? `All (${n})` : `Top ${n}`}</option>
            ))}
          </select>
        </div>
      </div>


      <ol className="mt-3 divide-y divide-paper-border/70 border-t border-paper-border/70">
        {shown.map((a, i) => (
          <li key={a.name} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2">
            <span className="font-display text-[12px] font-semibold tabular-nums text-paper-muted">{i + 1}</span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium leading-tight">{a.name}</div>
              <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-paper-subtle">
                <div className="h-full rounded-full bg-paper-accent" style={{ width: `${top ? (a.mph / top) * 100 : 0}%` }} />
              </div>
            </div>
            <div className="text-right leading-tight">
              <div className="font-display text-[15px] font-semibold tabular-nums">{a.mph.toFixed(d)}</div>
              {range !== "day" && <div className="text-[10px] tabular-nums text-paper-muted">{a.date}</div>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
