import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import {
  athletesQO,
  testsQO,
  liftsQO,
  customMetricsQO,
  testTypesQO,
  athleteDisplayName,
} from "@/lib/queries";
import type { SpiderComparisonGroup, SpiderNormalizationMethod } from "@/lib/queries";
import {
  QUALITIES,
  DEFAULT_CONFIG,
  MAX_METRICS_PER_QUALITY,
  MAX_HIGHLIGHTS,
  LEVEL_LABELS,
  metricOptions,
  metricLabelFor,
  computeAthleticismReport,
  UNMAPPED_QUALITY_HINT,
  type ReportConfig,
  type QualityKey,
} from "@/lib/athleticism-report";
import { buildReportPdf, captureSvgAsPng, type PdfSection } from "@/lib/report-export";
import { AthleteCombobox } from "@/components/athlete-combobox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Star, Plus, X, Download, RotateCcw, Radar as RadarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/athleticism-report")({
  head: () => ({ meta: [{ title: "Athleticism Report — Strength Lab" }] }),
  component: AthleticismReportPage,
});

const CONFIG_KEY = "sl.athleticismReport.config";

function loadConfig(): ReportConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      qualityMetrics: { ...DEFAULT_CONFIG.qualityMetrics, ...(parsed.qualityMetrics ?? {}) },
      sections: { ...DEFAULT_CONFIG.sections, ...(parsed.sections ?? {}) },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

const GROUP_OPTIONS: { value: SpiderComparisonGroup; label: string }[] = [
  { value: "team", label: "Team" },
  { value: "sport", label: "Sport" },
  { value: "position", label: "Position" },
  { value: "grade", label: "Grade" },
  { value: "org", label: "Organization" },
];
const NORM_OPTIONS: { value: SpiderNormalizationMethod; label: string }[] = [
  { value: "percentile", label: "Percentile vs. group" },
  { value: "pb_percent", label: "% of personal best" },
  { value: "threshold", label: "% of group best" },
];

function levelColor(level: number | null): string {
  if (level == null) return "oklch(0.6 0.02 260)";
  if (level >= 4) return "oklch(0.78 0.19 145)";
  if (level >= 3) return "oklch(0.82 0.17 95)";
  if (level >= 2) return "oklch(0.78 0.16 65)";
  return "oklch(0.68 0.18 30)";
}

function AthleticismReportPage() {
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: tests = [] } = useQuery(testsQO);
  const { data: lifts = [] } = useQuery(liftsQO);
  const { data: customMetrics = [] } = useQuery(customMetricsQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);

  const [athleteId, setAthleteId] = useState<string>("");
  const [config, setConfig] = useState<ReportConfig>(() => loadConfig());
  const [note, setNote] = useState<string | null>(null);
  const chartWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!athleteId && athletes.length) setAthleteId(athletes[0].id);
  }, [athletes, athleteId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      /* private-mode storage */
    }
  }, [config]);

  const options = useMemo(
    () => metricOptions(customTypes, customMetrics),
    [customTypes, customMetrics],
  );
  const athlete = athletes.find((a) => a.id === athleteId) ?? null;

  const report = useMemo(() => {
    if (!athlete) return null;
    return computeAthleticismReport({
      athlete,
      athletes,
      tests,
      lifts,
      customMetrics,
      customTypes,
      config,
    });
  }, [athlete, athletes, tests, lifts, customMetrics, customTypes, config]);

  const autoNote = report?.autoNote ?? "";
  const noteText = note ?? autoNote;

  function updateQuality(key: QualityKey, next: string[]) {
    setConfig((c) => ({ ...c, qualityMetrics: { ...c.qualityMetrics, [key]: next } }));
  }

  function addMetric(key: QualityKey, metricKey: string) {
    const cur = config.qualityMetrics[key] ?? [];
    if (cur.includes(metricKey) || cur.length >= MAX_METRICS_PER_QUALITY) return;
    updateQuality(key, [...cur, metricKey]);
  }

  function removeMetric(key: QualityKey, metricKey: string) {
    updateQuality(
      key,
      (config.qualityMetrics[key] ?? []).filter((k) => k !== metricKey),
    );
    if (config.starred.includes(metricKey)) {
      setConfig((c) => ({ ...c, starred: c.starred.filter((k) => k !== metricKey) }));
    }
  }

  function toggleStar(metricKey: string) {
    setConfig((c) => {
      if (c.starred.includes(metricKey))
        return { ...c, starred: c.starred.filter((k) => k !== metricKey) };
      if (c.starred.length >= MAX_HIGHLIGHTS) {
        toast.error(`Only ${MAX_HIGHLIGHTS} highlighted stats allowed — remove one first`);
        return c;
      }
      return { ...c, starred: [...c.starred, metricKey] };
    });
  }

  function resetDefaults() {
    setConfig(DEFAULT_CONFIG);
    setNote(null);
    toast.success("Reset to default quality mapping");
  }

  const radarData = useMemo(
    () =>
      (report?.qualities ?? []).map((q) => ({
        axis: q.label,
        value: q.avgNormalized ?? 0,
        missing: q.avgNormalized == null,
      })),
    [report],
  );

  async function downloadPdf() {
    if (!athlete || !report) return;
    const sections: PdfSection[] = [];
    sections.push({ kind: "heading", text: athleteDisplayName(athlete), level: 1 });
    sections.push({
      kind: "kv",
      rows: [
        ["Sport", [athlete.sport, athlete.position].filter(Boolean).join(" · ") || "—"],
        ["Grade", athlete.grade != null ? String(athlete.grade) : "—"],
        ["Team", athlete.team_id ? "Assigned" : "—"],
        [
          "Athleticism Level",
          `${report.overallLevelLabel}${report.overallLevel != null ? ` (${report.overallLevel}/4)` : ""}`,
        ],
      ],
    });

    if (report.highlighted.length) {
      sections.push({ kind: "heading", text: "Highlighted stats", level: 2 });
      sections.push({
        kind: "table",
        head: ["Stat", "Quality", "Result"],
        body: report.highlighted.map((h) => [
          h.label,
          h.qualityLabel,
          h.raw != null ? `${h.raw}${h.unit}` : "—",
        ]),
      });
    }

    if (config.sections.spider) {
      const svg = chartWrapRef.current?.querySelector("svg");
      if (svg) {
        const captured = await captureSvgAsPng(svg as unknown as SVGSVGElement, 2);
        if (captured) {
          sections.push({ kind: "heading", text: "Athletic quality spider", level: 2 });
          const maxW = 520;
          const scale = Math.min(1, maxW / captured.w);
          sections.push({
            kind: "image",
            dataUrl: captured.dataUrl,
            w: captured.w * scale,
            h: captured.h * scale,
          });
        }
      }
    }

    sections.push({ kind: "heading", text: "Quality breakdown", level: 2 });
    sections.push({
      kind: "table",
      head: ["Quality", "Level", "Tests used"],
      body: report.qualities.map((q) => [
        q.label,
        q.avgNormalized == null ? "No data" : `${q.levelLabel} (${q.level}/4)`,
        q.metrics.length ? q.metrics.map((m) => m.label).join(", ") : "Not configured",
      ]),
    });

    if (config.sections.gainBoard && report.gainBoard.length) {
      sections.push({ kind: "heading", text: "Gain board", level: 2 });
      sections.push({
        kind: "table",
        head: ["Test", "Before", "After", "Change"],
        body: report.gainBoard.map((g) => [
          g.label,
          g.before != null ? `${g.before}${g.unit}` : "—",
          g.after != null ? `${g.after}${g.unit}` : "—",
          g.delta != null ? `${g.delta > 0 ? "+" : ""}${g.delta.toFixed(2)}${g.unit}` : "—",
        ]),
      });
    }

    if (config.sections.physicalProfile) {
      sections.push({ kind: "heading", text: "Physical profile", level: 2 });
      sections.push({
        kind: "kv",
        rows: [
          [
            "Height",
            athlete.height_in
              ? `${Math.floor(athlete.height_in / 12)}'${athlete.height_in % 12}"`
              : "—",
          ],
          ["Bodyweight", athlete.bodyweight ? `${athlete.bodyweight} lb` : "—"],
        ],
      });
    }

    sections.push({ kind: "heading", text: "Coach's note", level: 2 });
    sections.push({ kind: "kv", rows: [["Note", noteText]] });
    sections.push({ kind: "spacer", h: 16 });
    sections.push({
      kind: "kv",
      rows: [
        ["Disclaimer", "This is a coaching discussion tool, not a medical or scouting evaluation."],
      ],
    });

    buildReportPdf({
      title: "Athleticism Report",
      subtitle: athleteDisplayName(athlete),
      sections,
      filename: `athleticism-report-${athlete.name.replace(/\s+/g, "-").toLowerCase()}.pdf`,
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Athleticism Report</h1>
          <p className="text-sm text-muted-foreground">
            Build an 8-quality athlete report from real test data and export a printable PDF.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={resetDefaults}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset mapping
          </Button>
          <Button size="sm" onClick={downloadPdf} disabled={!athlete}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Download PDF
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        {/* CONFIG */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Athlete</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <AthleteCombobox athletes={athletes} value={athleteId} onChange={setAthleteId} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Compare vs.
                  </Label>
                  <Select
                    value={config.comparisonGroup}
                    onValueChange={(v) =>
                      setConfig((c) => ({ ...c, comparisonGroup: v as SpiderComparisonGroup }))
                    }
                  >
                    <SelectTrigger className="mt-1 h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GROUP_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Scoring
                  </Label>
                  <Select
                    value={config.normalizationMethod}
                    onValueChange={(v) =>
                      setConfig((c) => ({
                        ...c,
                        normalizationMethod: v as SpiderNormalizationMethod,
                      }))
                    }
                  >
                    <SelectTrigger className="mt-1 h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NORM_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Report sections</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {(
                [
                  ["spider", "Spider chart"],
                  ["gainBoard", "Gain board"],
                  ["physicalProfile", "Physical profile"],
                ] as const
              ).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between">
                  <Label className="text-sm font-normal">{label}</Label>
                  <Switch
                    checked={config.sections[k]}
                    onCheckedChange={(v) =>
                      setConfig((c) => ({ ...c, sections: { ...c.sections, [k]: v } }))
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Athletic qualities</CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Up to {MAX_METRICS_PER_QUALITY} tests per quality. Star up to {MAX_HIGHLIGHTS}{" "}
                across the whole report to highlight them.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {QUALITIES.map((q) => {
                const picked = config.qualityMetrics[q.key] ?? [];
                const available = options.filter((o) => !picked.includes(o.key));
                return (
                  <div key={q.key} className="rounded-lg border border-border/60 p-2.5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {q.label}
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {picked.map((k) => (
                        <div
                          key={k}
                          className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1"
                        >
                          <button
                            type="button"
                            onClick={() => toggleStar(k)}
                            aria-pressed={config.starred.includes(k)}
                            aria-label={config.starred.includes(k) ? "Unstar" : "Star to highlight"}
                            className="shrink-0"
                          >
                            <Star
                              className={cn(
                                "h-3.5 w-3.5",
                                config.starred.includes(k)
                                  ? "fill-[oklch(0.82_0.17_85)] text-[oklch(0.82_0.17_85)]"
                                  : "text-muted-foreground",
                              )}
                            />
                          </button>
                          <span className="min-w-0 flex-1 truncate text-xs">
                            {metricLabelFor(k, options)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeMetric(q.key, k)}
                            aria-label="Remove"
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      {picked.length < MAX_METRICS_PER_QUALITY && (
                        <Select value="" onValueChange={(v) => addMetric(q.key, v)}>
                          <SelectTrigger className="h-8 text-xs text-muted-foreground">
                            <Plus className="mr-1 h-3 w-3" />{" "}
                            <SelectValue placeholder="Add a test or metric" />
                          </SelectTrigger>
                          <SelectContent>
                            {available.map((o) => (
                              <SelectItem key={o.key} value={o.key} className="text-xs">
                                {o.label} <span className="text-muted-foreground">· {o.group}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {picked.length === 0 && UNMAPPED_QUALITY_HINT[q.key] && (
                        <p className="text-[11px] text-muted-foreground">
                          {UNMAPPED_QUALITY_HINT[q.key]}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {/* PREVIEW */}
        <div className="space-y-4">
          {!athlete || !report ? (
            <Card className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
              Add athletes to your roster to build a report.
            </Card>
          ) : (
            <>
              <Card className="overflow-hidden">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div className="flex items-center gap-3 min-w-0">
                    {athlete.photo_url ? (
                      <img
                        src={athlete.photo_url}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded-full border border-border object-cover"
                      />
                    ) : (
                      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-dashed border-border text-muted-foreground text-xs">
                        No photo
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-display text-xl font-semibold">
                        {athleteDisplayName(athlete)}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        {[
                          athlete.sport,
                          athlete.position,
                          athlete.grade != null ? `Grade ${athlete.grade}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No sport/position on file"}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      Athleticism level
                    </div>
                    <div
                      className="font-display text-3xl font-black"
                      style={{ color: levelColor(report.overallLevel) }}
                    >
                      {report.overallLevel != null ? `${report.overallLevel}/4` : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">{report.overallLevelLabel}</div>
                  </div>
                </CardContent>
              </Card>

              {report.highlighted.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-3">
                  {report.highlighted.map((h) => (
                    <Card
                      key={h.key}
                      className="border-[oklch(0.82_0.17_85)]/40 bg-[oklch(0.82_0.17_85)]/[0.06]"
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[oklch(0.7_0.15_85)]">
                          <Star className="h-3 w-3 fill-current" /> {h.qualityLabel}
                        </div>
                        <div className="mt-1 font-display text-2xl font-bold tabular-nums">
                          {h.raw != null ? `${h.raw}${h.unit}` : "No data"}
                        </div>
                        <div className="text-xs text-muted-foreground">{h.label}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {config.sections.spider && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <RadarIcon className="h-4 w-4" /> Athletic quality spider
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div ref={chartWrapRef} className="h-[340px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart
                          data={radarData}
                          outerRadius="70%"
                          margin={{ top: 20, right: 30, bottom: 20, left: 30 }}
                        >
                          <PolarGrid stroke="color-mix(in oklab, var(--foreground) 12%, transparent)" />
                          <PolarAngleAxis
                            dataKey="axis"
                            tick={{
                              fill: "var(--color-muted-foreground)",
                              fontSize: 11,
                              fontWeight: 500,
                            }}
                            tickLine={false}
                          />
                          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                          <Radar
                            dataKey="value"
                            stroke="oklch(0.82 0.17 85)"
                            strokeWidth={2.4}
                            fill="oklch(0.82 0.17 85)"
                            fillOpacity={0.16}
                            isAnimationActive={false}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Quality breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {report.qualities.map((q) => (
                    <div
                      key={q.key}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{q.label}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {q.metrics.length
                            ? q.metrics.map((m) => m.label).join(", ")
                            : "Not configured"}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className="shrink-0"
                        style={{ borderColor: levelColor(q.level), color: levelColor(q.level) }}
                      >
                        {q.avgNormalized == null ? "No data" : `${q.levelLabel} · ${q.level}/4`}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {config.sections.gainBoard && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Gain board</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {report.gainBoard.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Needs at least two logged results for a test to show before/after.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {report.gainBoard.map((g) => (
                          <div
                            key={g.key}
                            className="flex items-center justify-between gap-3 text-sm"
                          >
                            <span className="min-w-0 truncate">{g.label}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {g.before}
                              {g.unit} → {g.after}
                              {g.unit}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 tabular-nums font-medium",
                                g.improved
                                  ? "text-[oklch(0.68_0.17_150)]"
                                  : "text-muted-foreground",
                              )}
                            >
                              {g.delta != null && g.delta > 0 ? "+" : ""}
                              {g.delta?.toFixed(2)}
                              {g.unit}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {config.sections.physicalProfile && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Physical profile</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Profile
                      label="Height"
                      value={
                        athlete.height_in
                          ? `${Math.floor(athlete.height_in / 12)}'${athlete.height_in % 12}"`
                          : "—"
                      }
                    />
                    <Profile
                      label="Bodyweight"
                      value={athlete.bodyweight ? `${athlete.bodyweight} lb` : "—"}
                    />
                    <Profile
                      label="Grade"
                      value={athlete.grade != null ? String(athlete.grade) : "—"}
                    />
                    <Profile label="Position" value={athlete.position || "—"} />
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Coach's note</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Textarea
                    value={noteText}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    className="text-sm"
                  />
                  {note != null && note !== autoNote && (
                    <Button variant="ghost" size="sm" onClick={() => setNote(null)}>
                      Use auto-generated note
                    </Button>
                  )}
                </CardContent>
              </Card>

              <p className="text-center text-[11px] text-muted-foreground">
                This is a coaching discussion tool, not a medical or scouting evaluation.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Profile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}
