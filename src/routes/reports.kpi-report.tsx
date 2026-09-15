import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import {
  PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer,
} from "recharts";
import { Download, FileText, Image as ImageIcon, Printer, Upload, ClipboardList, RotateCcw, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { MarketingShell } from "@/components/marketing-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { downloadTextFile } from "@/lib/gps-report";
import { downloadCardPng, exportCardsPdf } from "@/lib/card-export";
import {
  buildAthletes, CATEGORY_LABEL, exportKpiPdf, fmtVal, kpiCsv, metricSnapshot, parseKpiWorkbook,
  QUADRANT_LABEL, SCORED_CATEGORIES,
  type AthleteKpi, type KpiParse, type MetricSnapshot, type Quadrant,
} from "@/lib/kpi-report";

export const Route = createFileRoute("/reports/kpi-report")({
  head: () => ({
    meta: [
      { title: "Free KPI Report Card Builder — Strength Lab Hub" },
      { name: "description", content: "Upload your testing spreadsheet and instantly build athlete KPI report cards: strength, power, speed and change-of-direction scores, trends and a performance matrix. Free, no login, nothing saved." },
      { property: "og:title", content: "Free KPI Report Card Builder" },
      { property: "og:description", content: "Turn a testing spreadsheet into printable athlete KPI report cards in seconds — free, no account, processed in your browser." },
      { property: "og:url", content: "https://www.strengthlabhub.com/reports/kpi-report" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://www.strengthlabhub.com/reports/kpi-report" }],
  }),
  component: KpiReportTool,
});

const EMPTY: KpiParse = { columns: [], records: [], skipped: 0, sheet: null };

function KpiReportTool() {
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const [parse, setParse] = useState<KpiParse>(EMPTY);
  const [fileName, setFileName] = useState<string | null>(null);
  const [team, setTeam] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [snapshotKey, setSnapshotKey] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const matrixRef = useRef<HTMLElement | null>(null);
  const snapshotRef = useRef<HTMLElement | null>(null);

  const athletes = useMemo(() => (parse.records.length ? buildAthletes(parse) : []), [parse]);

  const scoredColumns = useMemo(() => parse.columns.filter((c) => c.category !== "body"), [parse]);
  const activeKey = scoredColumns.some((c) => c.key === snapshotKey)
    ? snapshotKey
    : (scoredColumns[0]?.key ?? "");
  const snapshot = useMemo(
    () => (activeKey ? metricSnapshot(parse, activeKey) : null),
    [parse, activeKey],
  );


  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? athletes.filter((a) => a.name.toLowerCase().includes(q)) : athletes;
  }, [athletes, search]);

  const dates = useMemo(
    () => Array.from(new Set(parse.records.map((r) => r.date).filter(Boolean) as string[])).sort(),
    [parse],
  );
  const latest = dates[dates.length - 1] ?? null;

  const teamScore = useMemo(() => {
    const vals = athletes.map((a) => a.overall).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }, [athletes]);

  const selfAvg = useMemo(() => {
    const vals = athletes.map((a) => a.momentum).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }, [athletes]);




  async function handleFile(file: File) {
    setBusy(true);
    try {
      const parsed = parseKpiWorkbook(await file.arrayBuffer());
      if (!parsed.records.length || !parsed.columns.length) {
        toast.error("No athlete rows found. The sheet needs a header row with an Athlete/Name column.");
        return;
      }
      setParse(parsed);
      setFileName(file.name);
      toast.success(`Loaded ${parsed.records.length} rows · ${parsed.columns.length} KPIs`);
    } catch {
      toast.error("Couldn't read that file. Export it as .xlsx or .csv and try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleLogo(file: File) {
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.onerror = () => toast.error("Could not read that image.");
    reader.readAsDataURL(file);
  }

  async function saveCardsPdf() {
    const cards = shown.map((a) => cardRefs.current.get(a.name)).filter((el): el is HTMLElement => !!el);
    const nodes = [matrixRef.current, snapshotRef.current, ...cards].filter((el): el is HTMLElement => !!el);
    if (!nodes.length) return;

    setBusy(true);
    try {
      await exportCardsPdf(nodes, {
        title: team ? `${team} — KPI Performance Report` : "KPI Performance Report",
        subtitle: `${athletes.length} athletes${latest ? ` · latest test ${latest}` : ""}`,
        filename: `kpi-cards${latest ? `-${latest}` : ""}.pdf`,
      });
    } catch (e) {
      console.error(e);
      toast.error("Could not save PDF. Try the Print button instead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <MarketingShell>
      <section className="mx-auto max-w-6xl px-4 pt-14 pb-8">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-[0.2em] text-[color:oklch(0.72_0.18_255)]">Free reports</div>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">KPI Report Card Builder</h1>
          <p className="mt-4 text-muted-foreground">
            Upload your testing spreadsheet — squat, bench, clean, vertical, 10s, 40s, pro agility, whatever you
            track — and get scored athlete report cards with category scores, team ranking, trends and a
            speed–strength matrix. Your file never leaves your device and nothing is saved.
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

        <input
          ref={logoRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleLogo(f);
            e.target.value = "";
          }}
        />


        <div className="mt-8 flex flex-wrap items-center gap-2">
          <Button size="lg" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="mr-2 h-4 w-4" />
            {busy ? "Reading…" : athletes.length ? "Load another sheet" : "Upload testing sheet"}
          </Button>
          <Button variant="outline" size="lg" onClick={() => logoRef.current?.click()}>
            <ImageIcon className="mr-2 h-4 w-4" /> {logo ? "Change team logo" : "Add team logo"}
          </Button>
          {logo && (
            <Button variant="ghost" size="lg" onClick={() => setLogo(null)}>
              Remove logo
            </Button>
          )}

          {athletes.length > 0 && (
            <>
              <Button variant="outline" size="lg" disabled={busy} onClick={() => void saveCardsPdf()}>
                <FileText className="mr-2 h-4 w-4" /> Save PDF
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => exportKpiPdf(athletes, parse.columns, {
                  title: team ? `${team} — KPI Performance Report` : "KPI Performance Report",
                  subtitle: `${athletes.length} athletes${latest ? ` · latest test ${latest}` : ""}`,
                  filename: `kpi-report${latest ? `-${latest}` : ""}.pdf`,
                })}
              >
                <FileText className="mr-2 h-4 w-4" /> Data PDF
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => downloadTextFile(kpiCsv(athletes, parse.columns), `kpi-report${latest ? `-${latest}` : ""}.csv`)}
              >
                <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
              <Button variant="outline" size="lg" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" /> Print
              </Button>
              <Button variant="ghost" size="lg" onClick={() => { setParse(EMPTY); setFileName(null); }}>
                <RotateCcw className="mr-2 h-4 w-4" /> Clear
              </Button>
            </>
          )}
        </div>

        {fileName && (
          <p className="mt-3 text-xs text-muted-foreground">
            {fileName} · {parse.records.length} rows · {parse.columns.length} KPIs · {athletes.length} athletes
          </p>
        )}
      </section>

      {athletes.length === 0 ? (
        <section className="mx-auto max-w-6xl px-4 pb-24">
          <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center">
            <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
            <div className="mt-4 font-display text-xl font-semibold">Nothing loaded yet</div>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
              One row per athlete (or one row per athlete per test date). Include an <strong>Athlete</strong> column,
              an optional <strong>Date</strong> column, and one column per KPI. Timed tests like a 40, pro agility or
              a fly are automatically scored as lower-is-better; lifts, jumps and MPH as higher-is-better.
            </p>
          </div>
        </section>
      ) : (
        <section className="mx-auto max-w-6xl px-4 pb-24">
          <div className="print-sheet rounded-2xl bg-paper p-5 text-paper-foreground shadow-2xl sm:p-8">
            <header className="border-b border-paper-border pb-5">
              <div className="flex items-start gap-3">
                {logo && (
                  <img src={logo} alt="Team logo" className="h-12 w-12 shrink-0 rounded-lg object-contain sm:h-14 sm:w-14" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-paper-muted">KPI Performance Report</div>
                  <input
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                    placeholder="Add team or program name"
                    className="mt-1 w-full max-w-md truncate border-0 bg-transparent p-0 font-display text-xl font-bold tracking-tight text-paper-foreground outline-none placeholder:text-paper-border sm:text-3xl"
                  />
                  <div className="mt-1 text-[11px] leading-snug text-paper-muted sm:text-xs">
                    {athletes.length} athletes · {parse.columns.length} KPIs
                    {dates.length > 1 ? ` · ${dates[0]} → ${latest}` : latest ? ` · ${latest}` : ""}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-3 sm:flex sm:justify-end sm:gap-8">
                <div className="rounded-lg bg-paper-subtle px-3 py-2 sm:bg-transparent sm:p-0 sm:text-right">
                  <div className="text-[9.5px] uppercase tracking-[0.14em] text-paper-muted">Team score</div>
                  <div className="font-display text-2xl font-semibold tabular-nums">
                    {teamScore == null ? "—" : teamScore.toFixed(0)}
                  </div>
                </div>
                <div className="rounded-lg bg-paper-subtle px-3 py-2 sm:bg-transparent sm:p-0 sm:text-right">
                  <div className="text-[9.5px] uppercase tracking-[0.14em] text-paper-muted">Avg self score</div>
                  <div className="font-display text-2xl font-semibold tabular-nums">
                    {selfAvg == null ? "—" : selfAvg.toFixed(0)}
                  </div>
                </div>
              </div>
            </header>


            <PerformanceMatrix athletes={athletes} onRef={(el) => { matrixRef.current = el; }} logo={logo} />

            {snapshot && (
              <MetricCountCard
                snapshot={snapshot}
                columns={scoredColumns.map((c) => ({ key: c.key, label: c.label }))}
                activeKey={activeKey}
                onSelect={setSnapshotKey}
                onRef={(el) => { snapshotRef.current = el; }}
                logo={logo}
              />
            )}






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
              {shown.map((a) => (
                <AthleteKpiCard
                  key={a.name}
                  athlete={a}
                  logo={logo}

                  onRef={(el) => { if (el) cardRefs.current.set(a.name, el); else cardRefs.current.delete(a.name); }}
                  onDownload={async () => {
                    const node = cardRefs.current.get(a.name);
                    if (!node) return;
                    try {
                      await downloadCardPng(node, `kpi-card-${a.name}.png`);
                    } catch (e) {
                      console.error(e);
                      toast.error("Could not export card.");
                    }
                  }}
                />
              ))}
            </div>

            <footer className="mt-8 border-t border-paper-border pt-4 text-[10px] uppercase tracking-[0.18em] text-paper-muted">
              Strength Lab Hub · strengthlabhub.com · scores are ranked within this file only
            </footer>
          </div>
        </section>
      )}
    </MarketingShell>
  );
}

const QUAD_STYLE: Record<Quadrant, string> = {
  "hs-hstr": "bg-paper-diamond/12 text-paper-diamond",
  "hs-lstr": "bg-paper-platinum/12 text-paper-platinum",
  "ls-hstr": "bg-paper-gold/12 text-paper-gold",
  "ls-lstr": "bg-paper-silver/12 text-paper-silver",
};

const GRADE_STYLE: Record<AthleteKpi["grade"]["key"], string> = {
  diamond: "bg-paper-diamond/15 text-paper-diamond",
  platinum: "bg-paper-platinum/15 text-paper-platinum",
  gold: "bg-paper-gold/15 text-paper-gold",
  silver: "bg-paper-silver/15 text-paper-silver",
  bronze: "bg-paper-bronze/15 text-paper-bronze",
};

const QUAD_ORDER: Quadrant[] = ["hs-lstr", "hs-hstr", "ls-lstr", "ls-hstr"];

/** Faint centered team logo behind card content. */
function Watermark({ logo }: { logo: string | null }) {
  if (!logo) return null;
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <img src={logo} alt="" className="max-h-[70%] max-w-[60%] object-contain opacity-[0.07]" />
    </div>
  );
}

function MetricCountCard({
  snapshot, columns, activeKey, onSelect, onRef, logo,
}: {
  snapshot: MetricSnapshot;
  columns: { key: string; label: string }[];
  activeKey: string;
  onSelect: (key: string) => void;
  onRef: (el: HTMLElement | null) => void;
  logo: string | null;
}) {
  const n = snapshot.dates.length;
  return (
    <section ref={onRef} className="relative mt-5 overflow-hidden rounded-xl border border-paper-border bg-paper-subtle px-4 py-3.5">
      <Watermark logo={logo} />
      <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-paper-muted">
            KPI metric count
          </div>
          <div className="font-display text-lg font-bold tracking-tight">{snapshot.column.label}</div>
        </div>
        <select
          value={activeKey}
          onChange={(e) => onSelect(e.target.value)}
          data-export-hide
          className="h-9 max-w-[55%] truncate rounded-md border border-paper-border bg-paper px-2 text-[12px] text-paper-foreground print:hidden"
        >
          {columns.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
      </div>
      <p className="relative mt-1.5 text-[12px] leading-relaxed text-paper-muted">
        How many athletes have reached each level, plus team average, best and lowest per test date.
        {snapshot.column.lowerBetter ? " Timed test — counts are athletes at or under each mark." : " Counts are athletes at or above each mark."}
      </p>

      <div className="relative mt-3 overflow-x-auto rounded-lg border border-paper-border bg-paper">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-paper-subtle text-[9.5px] uppercase tracking-[0.1em] text-paper-muted">
              <th className="px-2.5 py-1.5 text-left font-medium">Level</th>
              {snapshot.dates.map((d) => (
                <th key={d} className="px-2.5 py-1.5 text-right font-medium">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(["Team avg", "Best", "Lowest"] as const).map((label, i) => {
              const row = i === 0 ? snapshot.avg : i === 1 ? snapshot.max : snapshot.min;
              return (
                <tr key={label} className="border-t border-paper-border bg-paper-subtle/60">
                  <td className="px-2.5 py-1.5 font-semibold uppercase tracking-[0.06em] text-[10px] text-paper-muted">{label}</td>
                  {row.map((v, k) => (
                    <td key={k} className="px-2.5 py-1.5 text-right font-semibold tabular-nums">{fmtVal(v)}</td>
                  ))}
                </tr>
              );
            })}
            {snapshot.bands.map((b) => (
              <tr key={b.threshold} className="border-t border-paper-border">
                <td className="px-2.5 py-1.5 font-medium tabular-nums">{fmtVal(b.threshold)}</td>
                {b.counts.map((c, k) => (
                  <td key={k} className="px-2.5 py-1.5 text-right tabular-nums">{c}</td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-paper-border bg-paper-subtle">
              <td className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-paper-muted">Total athletes</td>
              {snapshot.total.map((t, k) => (
                <td key={k} className="px-2.5 py-1.5 text-right font-semibold tabular-nums">{t}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {n === 0 && <div className="relative mt-2 text-[12px] text-paper-muted">No results for this KPI.</div>}
    </section>
  );
}

function PerformanceMatrix({ athletes, onRef, logo }: { athletes: AthleteKpi[]; onRef: (el: HTMLElement | null) => void; logo: string | null }) {
  return (
    <section ref={onRef} className="relative mt-5 overflow-hidden rounded-xl border border-paper-border bg-paper-subtle px-4 py-3.5">
      <Watermark logo={logo} />

      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-paper-muted">
        Athletic performance matrix
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-paper-muted">
        Each athlete is placed by comparing their speed score to their strength score against the group in this
        file. It shows at a glance who needs speed work, who needs the weight room, and who is well rounded.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {QUAD_ORDER.map((q) => {
          const list = athletes.filter((a) => a.quadrant === q);
          return (
            <div key={q} className="rounded-lg bg-paper px-3 py-2.5">
              <div className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]", QUAD_STYLE[q])}>
                {QUADRANT_LABEL[q]}
              </div>
              <div className="mt-1.5 text-[11.5px] leading-relaxed text-paper-muted">
                {list.length ? list.map((a) => a.name).join(" · ") : "No athletes"}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AthleteKpiCard({
  athlete, onRef, onDownload, logo,
}: {
  athlete: AthleteKpi;
  onRef: (el: HTMLElement | null) => void;
  onDownload: () => void;
  logo: string | null;
}) {
  const radar = SCORED_CATEGORIES.filter((c) => athlete.categoryScores[c] != null).map((c) => ({
    cat: CATEGORY_LABEL[c] === "Change of Direction" ? "COD" : CATEGORY_LABEL[c],
    v: Math.round(athlete.categoryScores[c] as number),
  }));
  const id = `k-${athlete.name.replace(/\W+/g, "")}`;
  const metrics = athlete.metrics.filter((m) => m.value != null && m.column.category !== "body");
  const movers = metrics.filter((m) => m.delta != null && m.delta !== 0);

  return (
    <article ref={onRef} className="relative overflow-hidden break-inside-avoid rounded-xl border border-paper-border bg-paper p-4">
      <Watermark logo={logo} />
      <header className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">

        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-bold tracking-tight">{athlete.name}</h3>
          <div className="text-[11px] text-paper-muted">
            {athlete.latestDate ? `Tested ${athlete.latestDate}` : "Latest test"}
            {athlete.ppi != null ? ` · ${athlete.ppi.toFixed(2)} lb/in` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
            GRADE_STYLE[athlete.grade.key],
          )}>
            {athlete.grade.label}
          </span>
          <button
            type="button"
            onClick={onDownload}
            data-export-hide
            className="rounded-md p-1.5 text-paper-muted transition-colors hover:bg-paper-subtle hover:text-paper-foreground print:hidden"
            aria-label="Download card"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </header>

      {athlete.quadrant && (
        <div className={cn(
          "mt-2.5 inline-block rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
          QUAD_STYLE[athlete.quadrant],
        )}>
          {QUADRANT_LABEL[athlete.quadrant]}
        </div>
      )}


      <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <div className="grid gap-2">
          <div className="rounded-lg border border-paper-border bg-paper-subtle px-4 py-2.5 text-center">
            <div className="text-[9px] uppercase tracking-[0.16em] text-paper-muted">Team score</div>
            <div className="font-display text-[28px] font-bold leading-none tabular-nums">
              {athlete.overall == null ? "—" : athlete.overall.toFixed(0)}
            </div>
          </div>
          <div className="rounded-lg border border-paper-border bg-paper-subtle px-4 py-2 text-center">
            <div className="text-[9px] uppercase tracking-[0.16em] text-paper-muted">Self score</div>
            <div className="font-display text-[20px] font-bold leading-none tabular-nums">
              {athlete.momentum == null ? "—" : athlete.momentum.toFixed(0)}
            </div>
          </div>
        </div>
        <div className="h-[132px]">
          {radar.length >= 3 ? (
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radar} outerRadius="72%">
                <defs>
                  <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--paper-accent)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--paper-accent)" stopOpacity={0.08} />
                  </linearGradient>
                </defs>
                <PolarGrid stroke="var(--paper-border)" />
                <PolarAngleAxis dataKey="cat" tick={{ fontSize: 9, fill: "var(--paper-muted)" }} />
                <Radar dataKey="v" stroke="var(--paper-accent)" strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full content-center gap-1.5">
              {SCORED_CATEGORIES.filter((c) => athlete.categoryScores[c] != null).map((c) => (
                <ScoreBar key={c} label={CATEGORY_LABEL[c]} value={athlete.categoryScores[c] as number} />
              ))}
            </div>
          )}
        </div>
      </div>

      {radar.length >= 3 && (
        <div className="mt-3 grid gap-1.5">
          {SCORED_CATEGORIES.filter((c) => athlete.categoryScores[c] != null).map((c) => (
            <ScoreBar key={c} label={CATEGORY_LABEL[c]} value={athlete.categoryScores[c] as number} />
          ))}
        </div>
      )}

      <div className="mt-3.5 overflow-hidden rounded-lg border border-paper-border">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="bg-paper-subtle text-[9.5px] uppercase tracking-[0.1em] text-paper-muted">
              <th className="px-2.5 py-1.5 text-left font-medium">KPI</th>
              <th className="px-2 py-1.5 text-right font-medium">Latest</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Self</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.column.key} className="border-t border-paper-border">
                <td className="truncate px-2.5 py-1.5">{m.column.label}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmtVal(m.value)}</td>
                <td className="px-2.5 py-1.5 text-right font-medium tabular-nums">
                  {m.self == null ? "—" : m.self.score.toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {movers.length > 0 && (
        <div className="mt-3">
          <div className="text-[9.5px] uppercase tracking-[0.14em] text-paper-muted">Change since last test</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {movers.map((m) => (
              <span
                key={m.column.key}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                  m.improved ? "bg-paper-good/12 text-paper-good" : "bg-paper-danger/12 text-paper-danger",
                )}
              >
                {m.improved ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {m.column.label} {(m.delta as number) > 0 ? "+" : ""}{(m.delta as number).toFixed(2)}
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid grid-cols-[70px_minmax(0,1fr)_28px] items-center gap-2">
      <div className="truncate text-[10px] uppercase tracking-[0.1em] text-paper-muted">{label}</div>
      <div className="h-1.5 overflow-hidden rounded-full bg-paper-subtle">
        <div className="h-full rounded-full bg-paper-accent" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </div>
      <div className="text-right text-[11px] font-semibold tabular-nums">{value.toFixed(0)}</div>
    </div>
  );
}
