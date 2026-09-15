// Shared export helpers for the GPS tool (coach app + free public tool).
import { buildReportPdf, type PdfSection } from "./report-export";
import { captureNodePng } from "./card-export";
import { BOARD_METRICS, GPS_METRICS, boardMetricValue, loadStatus, statusLabel, summarize, type BoardMetricKey, type GpsMetricKey } from "./gps";
import { latestEffortVerdict, effortVerdict, combinedEffort } from "./gps-effort";


export type GpsReportRow = {
  player_name: string;
  session_date: string;
  top_speed: number | null;
  peak_acceleration: number | null;
  sprint_yards: number | null;
  player_load: number | null;
  sprint_count: number | null;
  acceleration_count?: number | null;
  deceleration_count?: number | null;
};

const digits = (k: BoardMetricKey) => (k === "sprint_count" || k === "sprint_yards" || k === "combined_effort" || k === "loaf" ? 0 : 2);

/** Leaderboard entries for any board metric. Loafs use the weekday-average shortfall. */
export function boardEntries(
  rows: GpsReportRow[],
  key: BoardMetricKey,
  keep: (date: string) => boolean = () => true,
): { name: string; mph: number; date: string }[] {
  const best = new Map<string, { mph: number; date: string }>();
  if (key === "loaf") {
    for (const [name, list] of groupByPlayer(rows)) {
      for (const r of list) {
        if (!keep(r.session_date)) continue;
        const v = effortVerdict(r, list);
        if (v.kind !== "loaf" || v.diff == null) continue;
        const cur = best.get(name);
        if (!cur || v.diff > cur.mph) best.set(name, { mph: v.diff, date: r.session_date });
      }
    }
  } else {
    for (const r of rows) {
      const val = boardMetricValue(r as unknown as Record<string, unknown>, key);
      if (val == null || !keep(r.session_date)) continue;
      const cur = best.get(r.player_name);
      if (!cur || val > cur.mph) best.set(r.player_name, { mph: val, date: r.session_date });
    }
  }
  return Array.from(best.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.mph - a.mph);
}

/** Whether a board metric has any data in these rows. */
export function boardMetricAvailable(rows: GpsReportRow[], key: BoardMetricKey): boolean {
  if (key === "loaf") return rows.some((r) => combinedEffort(r) != null);
  return rows.some((r) => boardMetricValue(r as unknown as Record<string, unknown>, key) != null);
}
const n = (v: number | null | undefined, d: number) => (v == null ? "—" : Number(v).toFixed(d));

export function groupByPlayer<T extends GpsReportRow>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const arr = map.get(r.player_name);
    if (arr) arr.push(r);
    else map.set(r.player_name, [r]);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.session_date.localeCompare(b.session_date));
  return map;
}

export function gpsCsv(rows: GpsReportRow[]): string {
  const byPlayer = groupByPlayer(rows);
  const head = [
    "Player",
    "Sessions",
    "Load status",
    "Load ratio",
    "Combined efforts",
    "Weekday avg",
    "Effort note",
    ...GPS_METRICS.flatMap((m) => [`${m.label} today`, `${m.label} avg`, `${m.label} max`]),
  ];
  const lines = [head.join(",")];
  for (const [name, list] of Array.from(byPlayer.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const load = summarize(list as never, "player_load");
    const { ratio, status } = loadStatus(load.today, load.average);
    const cells = [
      `"${name.replace(/"/g, '""')}"`,
      String(list.length),
      statusLabel(status),
      ratio ? ratio.toFixed(2) : "",
      ...(() => {
        const v = latestEffortVerdict(list);
        if (!v || v.kind === "none") return ["", "", ""];
        return [String(v.total ?? ""), v.weekdayAvg == null ? "" : v.weekdayAvg.toFixed(1), `"${v.message.replace(/"/g, '""')}"`];
      })(),
      ...GPS_METRICS.flatMap((m) => {
        const s = summarize(list as never, m.key);
        const d = digits(m.key);
        return [n(s.today, d), n(s.average, d), n(s.max, d)].map((v) => (v === "—" ? "" : v));
      }),
    ];
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

export function downloadTextFile(content: string, filename: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The structured (tabular) portion of a GPS report — shared by the plain and hybrid PDFs. */
export function gpsReportSections(rows: GpsReportRow[], opts: { leaderboardLimit?: number; includeCardTables?: boolean; leaderboardMetric?: BoardMetricKey } = {}) {
  const byPlayer = groupByPlayer(rows);
  const dates = rows.map((r) => r.session_date).sort();
  const latest = dates[dates.length - 1] ?? "—";
  const day = rows.filter((r) => r.session_date === latest);
  const loads = day.map((r) => r.player_load).filter((v): v is number => v != null);
  const speeds = day.map((r) => r.top_speed).filter((v): v is number => v != null);
  const yards = day.map((r) => r.sprint_yards).filter((v): v is number => v != null);

  let high = 0;
  let low = 0;
  for (const r of day) {
    const hist = byPlayer.get(r.player_name) ?? [];
    const s = loadStatus(r.player_load, summarize(hist as never, "player_load").average).status;
    if (s === "high") high++;
    if (s === "low") low++;
  }

  const sections: PdfSection[] = [
    { kind: "heading", text: "Session summary", level: 1 },
    {
      kind: "kv",
      rows: [
        ["Session date", latest],
        ["Athletes tracked", String(day.length)],
        ["Date range", dates.length ? `${dates[0]} → ${latest}` : "—"],
        ["Avg player load", loads.length ? (loads.reduce((a, b) => a + b, 0) / loads.length).toFixed(1) : "—"],
        ["Fastest top speed", speeds.length ? `${Math.max(...speeds).toFixed(2)} mph` : "—"],
        ["Avg sprint yards", yards.length ? (yards.reduce((a, b) => a + b, 0) / yards.length).toFixed(0) : "—"],
        ["Load flags", `${high} high · ${low} low`],
      ],
    },
    { kind: "heading", text: `${BOARD_METRICS.find((m) => m.key === (opts.leaderboardMetric ?? "top_speed"))?.label ?? "Top speed"} leaderboard`, level: 1 },
    {
      kind: "table",
      head: ["#", "Athlete", "Best", "Date"],
      body: (() => {
        const key = opts.leaderboardMetric ?? "top_speed";
        const dec = digits(key);
        return boardEntries(rows, key)
          .slice(0, opts.leaderboardLimit ?? 10)
          .map((a, i) => [i + 1, a.name, a.mph.toFixed(dec), a.date]);
      })(),
    },
    { kind: "heading", text: "Team overview", level: 1 },
    {
      kind: "table",
      head: ["Athlete", "Sessions", "Status", "Load", "Top speed", "Sprint yd", "Efforts", "Day avg", "Effort note"],
      body: Array.from(byPlayer.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, list]) => {
          const load = summarize(list as never, "player_load");
          const { status } = loadStatus(load.today, load.average);
          const val = (k: GpsMetricKey) => n(summarize(list as never, k).today, digits(k));
          const v = latestEffortVerdict(list);
          return [
            name,
            list.length,
            statusLabel(status),
            val("player_load"),
            val("top_speed"),
            val("sprint_yards"),
            v && v.total != null ? String(v.total) : "—",
            v && v.weekdayAvg != null ? v.weekdayAvg.toFixed(1) : "—",
            v && v.kind !== "none" ? v.message : "—",
          ];
        }),
    },
  ];

  if (opts.includeCardTables !== false) {
    for (const [name, list] of Array.from(byPlayer.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      sections.push({ kind: "heading", text: name, level: 2 });
      sections.push({
        kind: "table",
        head: ["Metric", "Today", "Average", "Max"],
        body: GPS_METRICS.map((m) => {
          const s = summarize(list as never, m.key);
          const d = digits(m.key);
          return [`${m.label}${m.unit ? ` (${m.unit})` : ""}`, n(s.today, d), n(s.average, d), n(s.max, d)];
        }),
      });
    }
  }

  return { sections, latest, byPlayer };
}

/**
 * Hybrid PDF: the structured summary/leaderboard/overview tables from the report engine,
 * followed by the rendered visual athlete report cards captured from the page.
 */
export async function exportGpsHybridPdf(
  rows: GpsReportRow[],
  cardNodes: HTMLElement[],
  opts: { title?: string; subtitle?: string; filename?: string; leaderboardLimit?: number; leaderboardMetric?: BoardMetricKey } = {},
) {
  const { sections, latest, byPlayer } = gpsReportSections(rows, {
    leaderboardLimit: opts.leaderboardLimit,
    leaderboardMetric: opts.leaderboardMetric,
    includeCardTables: false,
  });

  // Letter page minus the margins used by buildReportPdf, leaving room for the heading.
  const contentW = 612 - 80;
  const contentH = 792 - 80 - 28;
  const cards: PdfSection[] = [];
  for (const node of cardNodes) {
    const shot = await captureNodePng(node, 2);
    if (!shot) continue;
    // Fit each athlete card to a single page (width and height).
    const scale = Math.min(contentW / shot.w, contentH / shot.h);
    if (cards.length) cards.push({ kind: "pagebreak" });
    cards.push({ kind: "image", dataUrl: shot.dataUrl, w: shot.w * scale, h: shot.h * scale });
  }
  if (cards.length) {
    sections.push({ kind: "pagebreak" }, { kind: "heading", text: "Athlete report cards", level: 1 }, ...cards);
  }

  buildReportPdf({
    title: opts.title ?? "GPS Performance Report",
    subtitle: opts.subtitle ?? `Latest session ${latest} · ${byPlayer.size} athletes`,
    sections,
    filename: opts.filename ?? `gps-report-${latest}.pdf`,
  });
}

/** Team + per-athlete GPS report as a print-ready PDF. */
export function exportGpsPdf(rows: GpsReportRow[], opts: { title?: string; subtitle?: string; filename?: string; leaderboardLimit?: number } = {}) {
  const { sections, latest, byPlayer } = gpsReportSections(rows, { leaderboardLimit: opts.leaderboardLimit });
  buildReportPdf({
    title: opts.title ?? "GPS Performance Report",
    subtitle: opts.subtitle ?? `Latest session ${latest} · ${byPlayer.size} athletes`,
    sections,
    filename: opts.filename ?? `gps-report-${latest}.pdf`,
  });
}

