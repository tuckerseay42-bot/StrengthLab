import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Download, FileText, Printer, Upload, Activity, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { MarketingShell } from "@/components/marketing-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  loadStatus, loadSavedMapping, rowsFromScan, saveMapping, scanGpsWorkbook, summarize,
  type ColumnMapping, type SheetScan, type BoardMetricKey,
} from "@/lib/gps";
import { GpsColumnMapper } from "@/components/gps-column-mapper";
import { downloadTextFile, exportGpsHybridPdf, gpsCsv, groupByPlayer, type GpsReportRow } from "@/lib/gps-report";
import { combinedEffort } from "@/lib/gps-effort";
import { downloadCardPng } from "@/lib/card-export";
import {
  AthleteReportCard, LoadLegend, PaperStat as Stat, SpeedLeaderboard, show, teamMaxes,
} from "@/components/gps-report-card";


export const Route = createFileRoute("/reports/gps-report")({
  head: () => ({
    meta: [
      { title: "Free GPS Report Card Builder — Strength Lab Hub" },
      { name: "description", content: "Upload your practice GPS export and instantly build clean athlete report cards: top speed, player load, sprint yards, load status. Free, no login, nothing uploaded." },
      { property: "og:title", content: "Free GPS Report Card Builder" },
      { property: "og:description", content: "Turn a raw GPS export into printable athlete report cards in seconds — free, no account, processed in your browser." },
      { property: "og:url", content: "https://www.strengthlabhub.com/reports/gps-report" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://www.strengthlabhub.com/reports/gps-report" }],
  }),
  component: GpsReportTool,
});




function GpsReportTool() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<GpsReportRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [team, setTeam] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const legendRef = useRef<HTMLElement | null>(null);
  const boardRef = useRef<HTMLElement | null>(null);
  const [boardLimit, setBoardLimit] = useState(10);
  const [boardMetric, setBoardMetric] = useState<BoardMetricKey>("top_speed");
  const [scan, setScan] = useState<SheetScan | null>(null);
  const [mapperOpen, setMapperOpen] = useState(false);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [practiceMinutes, setPracticeMinutes] = useState("");

  const byPlayer = useMemo(() => groupByPlayer(rows), [rows]);

  const players = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Array.from(byPlayer.keys())
      .sort((a, b) => a.localeCompare(b))
      .filter((p) => (q ? p.toLowerCase().includes(q) : true));
  }, [byPlayer, search]);

  const dates = useMemo(() => Array.from(new Set(rows.map((r) => r.session_date))).sort(), [rows]);
  const latest = dates[dates.length - 1] ?? null;

  const room = useMemo(() => {
    const day = rows.filter((r) => r.session_date === latest);
    const loads = day.map((r) => r.player_load).filter((v): v is number => v != null);
    const speeds = day.map((r) => r.top_speed).filter((v): v is number => v != null);
    const yards = day.map((r) => r.sprint_yards).filter((v): v is number => v != null);
    let high = 0;
    let low = 0;
    for (const r of day) {
      const s = loadStatus(r.player_load, summarize((byPlayer.get(r.player_name) ?? []) as never, "player_load").average).status;
      if (s === "high") high++;
      if (s === "low") low++;
    }
    const efforts = day.map((r) => combinedEffort(r)).filter((v): v is number => v != null);
    return {
      effortTotal: efforts.length ? efforts.reduce((a, b) => a + b, 0) : null,
      effortAvg: efforts.length ? efforts.reduce((a, b) => a + b, 0) / efforts.length : null,
      athletes: day.length,
      avgLoad: loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : null,
      topSpeed: speeds.length ? Math.max(...speeds) : null,
      avgYards: yards.length ? yards.reduce((a, b) => a + b, 0) / yards.length : null,
      high,
      low,
    };
  }, [rows, latest, byPlayer]);

  const minutes = Number(practiceMinutes) > 0 ? Number(practiceMinutes) : null;

  /** Team bests for the mini percentile-style bars on each card. */
  const teamMax = useMemo(() => teamMaxes(rows), [rows]);


  function applyMapping(s: SheetScan, mapping: ColumnMapping, name: string) {
    const parsed = rowsFromScan(s, mapping);
    if (!parsed.rows.length) {
      toast.error("No usable rows after filtering. Check the Date and Player Name columns.");
      return false;
    }
    setRows(parsed.rows as GpsReportRow[]);
    setFileName(name);
    toast.success(
      `Loaded ${parsed.rows.length} rows` +
        (parsed.filtered ? ` · ${parsed.filtered} no-signal rows excluded` : "") +
        (parsed.skipped ? ` · ${parsed.skipped} skipped` : ""),
    );
    return true;
  }

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const s = scanGpsWorkbook(await file.arrayBuffer());
      if (!s) {
        toast.error("Couldn't find a header row in that file. Export it as .xlsx or .csv and try again.");
        return;
      }
      setScan(s);
      setPendingName(file.name);
      const saved = loadSavedMapping(s);
      const mapping = saved ?? (s.missingRequired.length ? null : s.mapping);
      if (mapping) {
        applyMapping(s, mapping, file.name);
      } else {
        setMapperOpen(true);
      }
    } catch {
      toast.error("Couldn't read that file. Export it as .xlsx or .csv and try again.");
    } finally {
      setBusy(false);
    }
  }

  /** Hybrid PDF: structured summary + leaderboard + team tables, then the rendered cards. */
  async function saveCardsPdf() {
    const cards = players
      .map((p) => cardRefs.current.get(p))
      .filter((el): el is HTMLElement => !!el);
    if (!cards.length) return;
    const nodes = [legendRef.current, ...cards].filter((el): el is HTMLElement => !!el);
    setBusy(true);
    try {
      await exportGpsHybridPdf(rows, nodes, {
        title: team ? `${team} — GPS Performance Report` : "GPS Performance Report",
        subtitle: `Latest session ${latest} · ${byPlayer.size} athletes`,
        filename: `gps-report-${latest}.pdf`,
        leaderboardLimit: boardLimit,
        leaderboardMetric: boardMetric,
      });
    } catch (e) {
      console.error(e);
      toast.error("Could not save PDF. Try the Print button instead.");
    } finally {
      setBusy(false);
    }
  }


  async function downloadCard(name: string) {
    const node = cardRefs.current.get(name);
    if (!node) return;
    try {
      await downloadCardPng(node, `gps-card-${name}-${latest}.png`);
    } catch (e) {
      console.error(e);
      toast.error("Could not export card.");
    }
  }

  return (
    <MarketingShell>
      <GpsColumnMapper
        scan={scan}
        open={mapperOpen}
        onCancel={() => setMapperOpen(false)}
        onConfirm={(mapping, remember) => {
          if (!scan) return;
          if (applyMapping(scan, mapping, pendingName ?? fileName ?? "export")) {
            if (remember) saveMapping(scan, mapping);
            setMapperOpen(false);
          }
        }}
      />
      <section className="mx-auto max-w-6xl px-4 pt-14 pb-8">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-[0.2em] text-[color:oklch(0.72_0.18_255)]">Free reports</div>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">GPS Report Card Builder</h1>
          <p className="mt-4 text-muted-foreground">
            Drop in a practice GPS export and get clean, printable athlete report cards — top speed, peak
            acceleration, player load, sprint yards and load status. Your file never leaves your device; everything
            is parsed in the browser.
          </p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />

        <div className="mt-8 flex flex-wrap items-center gap-2">
          <Button size="lg" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="mr-2 h-4 w-4" />
            {busy ? "Reading…" : rows.length ? "Load another export" : "Upload GPS export"}
          </Button>
          {rows.length > 0 && (
            <>
              <Button
                variant="outline"
                size="lg"
                disabled={busy}
                onClick={() => void saveCardsPdf()}
              >
                <FileText className="mr-2 h-4 w-4" /> Save PDF
              </Button>
              <Button variant="outline" size="lg" onClick={() => downloadTextFile(gpsCsv(rows), `gps-report-${latest}.csv`)}>
                <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
              <Button variant="outline" size="lg" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" /> Print
              </Button>
              <Button variant="outline" size="lg" disabled={!scan} onClick={() => setMapperOpen(true)}>
                Match columns
              </Button>
              <Button variant="ghost" size="lg" onClick={() => { setRows([]); setFileName(null); setScan(null); }}>
                <RotateCcw className="mr-2 h-4 w-4" /> Clear
              </Button>
            </>
          )}
        </div>

        {fileName && (
          <p className="mt-3 text-xs text-muted-foreground">
            {fileName} · {rows.length} rows · {dates.length} session{dates.length === 1 ? "" : "s"} · {byPlayer.size} athletes
          </p>
        )}
      </section>

      {rows.length === 0 ? (
        <section className="mx-auto max-w-6xl px-4 pb-24">
          <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center">
            <Activity className="mx-auto h-8 w-8 text-muted-foreground" />
            <div className="mt-4 font-display text-xl font-semibold">Nothing loaded yet</div>
            <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
              Your export needs a header row containing <strong>Date</strong> and <strong>Player Name</strong>. Any of
              Top Speed, Peak Acceleration, Sprint Yards, Player Load and Sprint Count will be picked up
              automatically — column order doesn't matter.
            </p>
          </div>
        </section>
      ) : (
        <section className="mx-auto max-w-6xl px-4 pb-24">
          {/* Paper report sheet */}
          <div className="print-sheet rounded-2xl bg-paper p-5 text-paper-foreground shadow-2xl sm:p-8">
            <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b border-paper-border pb-5">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.22em] text-paper-muted">GPS Performance Report</div>
                <input
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  placeholder="Add team or program name"
                  className="mt-1 w-full max-w-md truncate border-0 bg-transparent p-0 font-display text-2xl font-bold tracking-tight text-paper-foreground outline-none placeholder:text-paper-border sm:text-3xl"
                />
                <div className="mt-1 text-xs text-paper-muted">
                  {dates.length > 1 ? `${dates[0]} → ${latest}` : latest} · {byPlayer.size} athletes
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[10px] uppercase tracking-[0.18em] text-paper-muted">Session</div>
                <div className="font-display text-lg font-semibold tabular-nums">{latest}</div>
              </div>
            </header>

            {/* Room strip */}
            <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-paper-border bg-paper-subtle px-4 py-3 print:hidden">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-paper-muted">Practice duration</div>
                <p className="mt-1 text-[11.5px] leading-tight text-paper-muted">
                  Enter minutes to see efforts per minute (acceleration count ÷ practice time).
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={practiceMinutes}
                  onChange={(e) => setPracticeMinutes(e.target.value)}
                  placeholder="90"
                  className="h-9 w-24 border-paper-border bg-paper text-right text-paper-foreground tabular-nums placeholder:text-paper-muted"
                />
                <span className="text-xs text-paper-muted">min</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-paper-border bg-paper-border sm:grid-cols-3 lg:grid-cols-6 mt-3">
              <Stat label="Athletes" value={String(room.athletes)} sub="this session" />
              <Stat label="Avg load" value={show(room.avgLoad, 1)} sub="player load" />
              <Stat label="Top speed" value={show(room.topSpeed, 2)} sub="mph" />
              <Stat label="Avg. Sprint Yards" value={show(room.avgYards, 0)} sub="per athlete" />
              <Stat
                label="Efforts / min"
                value={minutes && room.effortAvg != null ? (room.effortAvg / minutes).toFixed(2) : "—"}
                sub={minutes ? `avg accel + decel ÷ ${minutes} min` : "add practice duration"}
              />
              <Stat label="Flags" value={`${room.high}↑ / ${room.low}↓`} sub="high / low load" />
            </div>

            <LoadLegend onRef={(el) => { legendRef.current = el; }} />

            <SpeedLeaderboard
              rows={rows}
              limit={boardLimit}
              onLimitChange={setBoardLimit}
              metric={boardMetric}
              onMetricChange={setBoardMetric}
              onRef={(el) => { boardRef.current = el; }}
            />

            <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 print:hidden">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-paper-muted">Athlete report cards</div>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search athlete…"
                className="h-9 w-40 border-paper-border bg-paper-subtle text-paper-foreground placeholder:text-paper-muted sm:w-56"
              />
            </div>

            <div className="print-single-column mt-4 grid gap-4 lg:grid-cols-2">
              {players.map((p) => (
                <AthleteReportCard
                  key={p}
                  name={p}
                  rows={byPlayer.get(p) ?? []}
                  teamMax={teamMax}
                  practiceMinutes={minutes}
                  onRef={(el) => { if (el) cardRefs.current.set(p, el); else cardRefs.current.delete(p); }}
                  onDownloadCard={() => void downloadCard(p)}
                />
              ))}
            </div>

            <footer className="mt-8 border-t border-paper-border pt-4 text-[10px] uppercase tracking-[0.18em] text-paper-muted">
              Strength Lab Hub · strengthlabhub.com
            </footer>
          </div>
        </section>
      )}
    </MarketingShell>
  );
}
