import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Download, FileText, Upload } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { athletesQO } from "@/lib/queries";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  GPS_METRICS, fmt, loadStatus, loadSavedMapping, matchAthlete, rowsFromScan, saveMapping,
  scanGpsWorkbook, summarize,
  type ColumnMapping, type GpsMetricKey, type GpsRow, type SheetScan,
} from "@/lib/gps";
import { GpsColumnMapper } from "@/components/gps-column-mapper";
import { downloadTextFile, exportGpsHybridPdf, gpsCsv } from "@/lib/gps-report";
import { downloadCardPng } from "@/lib/card-export";
import {
  AthleteReportCard, LoadLegend, PaperStat, SpeedLeaderboard, show, teamMaxes,
} from "@/components/gps-report-card";

export const Route = createFileRoute("/gps")({
  head: () => ({
    meta: [
      { title: "GPS Tool — Strength Lab" },
      { name: "description", content: "Import GPS practice exports and see top speed, player load, sprint yards and load status by athlete." },
    ],
  }),
  component: GpsPage,
});

function GpsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [days, setDays] = useState("30");
  const [boardLimit, setBoardLimit] = useState(10);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<SheetScan | null>(null);
  const [mapperOpen, setMapperOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const legendRef = useRef<HTMLElement | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);

  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["gps_sessions"],
    queryFn: async (): Promise<GpsRow[]> => {
      const { data, error } = await supabase
        .from("gps_sessions" as never)
        .select("*")
        .order("session_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as GpsRow[];
    },
  });

  const windowed = useMemo(() => {
    if (days === "all") return rows;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(days));
    const iso = cutoff.toISOString().slice(0, 10);
    return rows.filter((r) => r.session_date >= iso);
  }, [rows, days]);

  const byPlayer = useMemo(() => {
    const map = new Map<string, GpsRow[]>();
    for (const r of windowed) {
      const arr = map.get(r.player_name);
      if (arr) arr.push(r);
      else map.set(r.player_name, [r]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.session_date.localeCompare(b.session_date));
    return map;
  }, [windowed]);

  const players = useMemo(() => {
    const list = Array.from(byPlayer.keys()).sort((a, b) => a.localeCompare(b));
    const q = search.trim().toLowerCase();
    return q ? list.filter((p) => p.toLowerCase().includes(q)) : list;
  }, [byPlayer, search]);

  const dates = useMemo(() => Array.from(new Set(windowed.map((r) => r.session_date))).sort(), [windowed]);
  const latestDate = dates[dates.length - 1] ?? null;

  const room = useMemo(() => {
    const day = windowed.filter((r) => r.session_date === latestDate);
    const loads = day.map((r) => r.player_load).filter((v): v is number => v != null);
    const speeds = day.map((r) => r.top_speed).filter((v): v is number => v != null);
    const yards = day.map((r) => r.sprint_yards).filter((v): v is number => v != null);
    let high = 0, low = 0;
    for (const r of day) {
      const hist = byPlayer.get(r.player_name) ?? [];
      const s = loadStatus(r.player_load, summarize(hist, "player_load").average).status;
      if (s === "high") high++;
      if (s === "low") low++;
    }
    return {
      athletes: day.length,
      avgLoad: loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : null,
      topSpeed: speeds.length ? Math.max(...speeds) : null,
      avgYards: yards.length ? yards.reduce((a, b) => a + b, 0) / yards.length : null,
      high, low,
    };
  }, [windowed, latestDate, byPlayer]);

  const teamMax = useMemo(() => teamMaxes(windowed), [windowed]);

  const importer = useMutation({
    mutationFn: async ({ scan, mapping, fileName: name }: { scan: SheetScan; mapping: ColumnMapping; fileName: string }) => {
      const org = await getScopedOrgId();
      const parsed = rowsFromScan(scan, mapping);
      if (!parsed.rows.length) {
        throw new Error("No usable GPS rows found after filtering. Check the Date and Player Name columns.");
      }
      const file = { name };
      const payload = parsed.rows.map((r) => ({
        organization_id: org,
        athlete_id: matchAthlete(r.player_name, athletes),
        player_name: r.player_name,
        session_date: r.session_date,
        top_speed: r.top_speed,
        peak_acceleration: r.peak_acceleration,
        sprint_yards: r.sprint_yards,
        player_load: r.player_load,
        sprint_count: r.sprint_count,
        acceleration_count: r.acceleration_count,
        deceleration_count: r.deceleration_count,
        source_file: file.name,
      }));
      const dateList = Array.from(new Set(payload.map((p) => p.session_date)));
      const names = Array.from(new Set(payload.map((p) => p.player_name)));
      const { error: delError } = await supabase
        .from("gps_sessions" as never)
        .delete()
        .eq("organization_id", org)
        .in("session_date", dateList)
        .in("player_name", names);
      if (delError) throw delError;
      const { error } = await supabase.from("gps_sessions" as never).insert(payload as never);
      if (error) throw error;
      return { count: payload.length, skipped: parsed.skipped, filtered: parsed.filtered };
    },
    onSuccess: ({ count, skipped, filtered }) => {
      toast.success(
        `Imported ${count} GPS rows` +
          (filtered ? ` · ${filtered} no-signal rows excluded` : "") +
          (skipped ? ` · ${skipped} skipped` : ""),
      );
      qc.invalidateQueries({ queryKey: ["gps_sessions"] });
    },
    onError: (e) => toast.error(toUserMessage(e)),
  });

  async function handlePickedFile(file: File) {
    try {
      const s = scanGpsWorkbook(await file.arrayBuffer());
      if (!s) {
        toast.error("Couldn't find a header row in that file.");
        return;
      }
      setScan(s);
      setPendingFile(file.name);
      const saved = loadSavedMapping(s);
      const mapping = saved ?? (s.missingRequired.length ? null : s.mapping);
      if (mapping) importer.mutate({ scan: s, mapping, fileName: file.name });
      else setMapperOpen(true);
    } catch {
      toast.error("Couldn't read that file. Export it as .xlsx or .csv and try again.");
    }
  }

  const detailRows = selected ? byPlayer.get(selected) ?? [] : [];

  async function savePdf() {
    const cards = players
      .map((p) => cardRefs.current.get(p))
      .filter((el): el is HTMLElement => !!el);
    setBusy(true);
    try {
      const nodes = [legendRef.current, ...cards].filter((el): el is HTMLElement => !!el);
      await exportGpsHybridPdf(windowed, nodes, {
        subtitle: `Latest session ${latestDate ?? "—"} · ${byPlayer.size} athletes`,
        filename: `gps-report-${latestDate ?? "export"}.pdf`,
        leaderboardLimit: boardLimit,
      });
    } catch (e) {
      console.error(e);
      toast.error("Could not save the PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <GpsColumnMapper
        scan={scan}
        open={mapperOpen}
        onCancel={() => setMapperOpen(false)}
        onConfirm={(mapping, remember) => {
          if (!scan) return;
          if (remember) saveMapping(scan, mapping);
          setMapperOpen(false);
          importer.mutate({ scan, mapping, fileName: pendingFile ?? "export" });
        }}
      />
      <PageHeader
        eyebrow="Tracking"
        title="GPS Tool"
        description="Import your practice GPS export and see top speed, player load, sprint output and load status for every athlete."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handlePickedFile(f);
                e.target.value = "";
              }}
            />
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => fileRef.current?.click()} disabled={importer.isPending}>
              <Upload className="mr-2 h-4 w-4" />
              {importer.isPending ? "Importing…" : "Import export"}
            </Button>
            <Button variant="outline" disabled={!windowed.length || busy} onClick={() => void savePdf()}>
              <FileText className="mr-2 h-4 w-4" /> {busy ? "Building…" : "PDF"}
            </Button>
            <Button
              variant="outline"
              disabled={!windowed.length}
              onClick={() => downloadTextFile(gpsCsv(windowed), `gps-report-${latestDate ?? "export"}.csv`)}
            >
              <Download className="mr-2 h-4 w-4" /> CSV
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading GPS data…</div>
      ) : !byPlayer.size ? (
        <EmptyState
          icon={Upload}
          title="No GPS data yet"
          description="Import a practice export (.xlsx or .csv) with Date, Player Name, Top Speed, Peak Acceleration, Sprint Yards, Player Load and Sprint Count."
          action={<Button onClick={() => fileRef.current?.click()}>Import export</Button>}
        />
      ) : (
        <div className="print-sheet rounded-2xl bg-paper p-4 text-paper-foreground shadow-2xl sm:p-7">
          <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b border-paper-border pb-5">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-paper-muted">GPS Performance Report</div>
              <div className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">Team overview</div>
              <div className="mt-1 text-xs text-paper-muted">
                {dates.length > 1 ? `${dates[0]} → ${latestDate}` : latestDate} · {byPlayer.size} athletes
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[10px] uppercase tracking-[0.18em] text-paper-muted">Session</div>
              <div className="font-display text-lg font-semibold tabular-nums">{latestDate}</div>
            </div>
          </header>

          <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-paper-border bg-paper-border sm:grid-cols-5">
            <PaperStat label="Athletes" value={String(room.athletes)} sub="this session" />
            <PaperStat label="Avg load" value={show(room.avgLoad, 1)} sub="player load" />
            <PaperStat label="Top speed" value={show(room.topSpeed, 2)} sub="mph" />
            <PaperStat label="Avg. Sprint Yards" value={show(room.avgYards, 0)} sub="per athlete" />
            <PaperStat label="Flags" value={`${room.high}↑ / ${room.low}↓`} sub="high / low load" className="col-span-2 sm:col-span-1" />
          </div>

          <LoadLegend onRef={(el) => { legendRef.current = el; }} />

          <SpeedLeaderboard rows={windowed} limit={boardLimit} onLimitChange={setBoardLimit} />

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
              <button
                key={p}
                type="button"
                onClick={() => setSelected(p)}
                className="rounded-xl text-left transition-shadow hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-paper-accent"
              >
                <AthleteReportCard
                  name={p}
                  rows={byPlayer.get(p) ?? []}
                  teamMax={teamMax}
                  onRef={(el) => { if (el) cardRefs.current.set(p, el); else cardRefs.current.delete(p); }}
                />
              </button>
            ))}
          </div>

          <footer className="mt-8 border-t border-paper-border pt-4 text-[10px] uppercase tracking-[0.18em] text-paper-muted">
            Strength Lab Hub · strengthlabhub.com
          </footer>
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto bg-paper text-paper-foreground">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-paper-foreground">{selected}</DialogTitle>
          </DialogHeader>
          {detailRows.length > 0 && selected && (
            <div className="space-y-4">
              <AthleteReportCard
                name={selected}
                rows={detailRows}
                teamMax={teamMax}
                onRef={(el) => { detailRef.current = el; }}
              />

              <section className="rounded-xl border border-paper-border bg-paper p-4">
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-paper-muted">
                  Session-by-session trend
                </div>
                <MetricTrend rows={detailRows} />
              </section>

              <div className="flex justify-end gap-2 pb-1">
                <Button
                  variant="outline"
                  onClick={() => {
                    const node = detailRef.current;
                    if (node) void downloadCardPng(node, `gps-card-${selected}-${latestDate}.png`).catch(() => toast.error("Could not export card."));
                  }}
                >
                  <Download className="mr-2 h-4 w-4" /> Download card
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Full-history line chart, metric switchable — the deeper coach-only view. */
function MetricTrend({ rows }: { rows: GpsRow[] }) {
  const [metric, setMetric] = useState<GpsMetricKey>("player_load");
  const data = rows.map((r) => ({ d: r.session_date.slice(5), v: r[metric] }));
  const s = summarize(rows, metric);
  const digits = metric === "sprint_count" || metric === "sprint_yards" ? 0 : 2;

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {GPS_METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMetric(m.key)}
            className={
              metric === m.key
                ? "rounded-full bg-paper-accent px-2.5 py-1 text-[11px] font-semibold text-paper"
                : "rounded-full bg-paper-subtle px-2.5 py-1 text-[11px] text-paper-muted"
            }
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="mt-3 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: -14, right: 8, top: 6 }}>
            <CartesianGrid vertical={false} stroke="currentColor" className="text-paper-border" />
            <XAxis dataKey="d" tick={{ fontSize: 11 }} stroke="currentColor" className="text-paper-muted" tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} stroke="currentColor" className="text-paper-muted" tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: "var(--paper)", border: "1px solid var(--paper-border)", borderRadius: 8, fontSize: 12, color: "var(--paper-foreground)" }}
              labelStyle={{ color: "var(--paper-muted)" }}
            />
            <Line type="monotone" dataKey="v" name={metric} strokeWidth={2} dot={{ r: 2 }} stroke="var(--paper-accent)" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        {(["today", "average", "max"] as const).map((k) => (
          <div key={k} className="rounded-lg bg-paper-subtle py-2">
            <div className="text-[10px] uppercase tracking-wide text-paper-muted">
              {k === "today" ? "Latest" : k === "average" ? "Avg" : "Max"}
            </div>
            <div className="font-display text-[15px] tabular-nums">{fmt(s[k], digits)}</div>
          </div>
        ))}
      </div>
    </>
  );
}
