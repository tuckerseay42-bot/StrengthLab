import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";
import {
  athletesQO, testsQO, liftsQO, customMetricsQO, testTypesQO,
  spiderTemplatesQO, spiderMetricsQO,
} from "@/lib/queries";
import type { Athlete, SpiderComparisonGroup } from "@/lib/queries";
import { computeSpider, pickTemplate, type SpiderRow } from "@/lib/spider";
import { useMyPermissions } from "@/hooks/use-permissions";

const GROUP_OPTIONS: { value: SpiderComparisonGroup; label: string }[] = [
  { value: "team", label: "Team (avg)" },
  { value: "sport", label: "Sport (avg)" },
  { value: "position", label: "Position (avg)" },
  { value: "grade", label: "Grade (avg)" },
  { value: "org", label: "Organization (avg)" },
];

// Percentile → dot color (green high → amber mid → soft red low)
function dotColorFor(p: number): string {
  if (p >= 75) return "oklch(0.78 0.19 145)"; // green
  if (p >= 50) return "oklch(0.82 0.17 95)";  // yellow-gold
  if (p >= 25) return "oklch(0.78 0.16 65)";  // amber
  return "oklch(0.68 0.18 30)";               // muted red-orange
}

export function AthleteSpiderGraph({ athlete }: { athlete: Athlete }) {
  const { data: templates = [] } = useQuery(spiderTemplatesQO);
  const { data: metricsAll = [] } = useQuery(spiderMetricsQO);
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: tests = [] } = useQuery(testsQO);
  const { data: lifts = [] } = useQuery(liftsQO);
  const { data: customMetrics = [] } = useQuery(customMetricsQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const { data: perms } = useMyPermissions();

  const canEdit = perms?.roles.some((r) => r === "owner" || r === "administrator" || r === "admin" || r === "coach" || r === "sport_coach")
    ?? false;

  const template = useMemo(() => pickTemplate(templates, athlete), [templates, athlete]);
  const templateMetrics = useMemo(
    () => (template ? metricsAll.filter((m) => m.template_id === template.id) : []),
    [template, metricsAll],
  );

  const [groupOverride, setGroupOverride] = useState<SpiderComparisonGroup | null>(null);
  const effectiveGroup: SpiderComparisonGroup | null = groupOverride ?? template?.comparison_group ?? null;

  const rows: SpiderRow[] = useMemo(() => {
    if (!template || !effectiveGroup) return [];
    return computeSpider({
      template: { ...template, comparison_group: effectiveGroup },
      metrics: templateMetrics, athlete,
      athletes, tests, lifts, customMetrics, customTypes,
    });
  }, [template, effectiveGroup, templateMetrics, athlete, athletes, tests, lifts, customMetrics, customTypes]);

  if (!template) return null;

  const visible = rows.filter((r) => !(r.missing && templateMetrics.find((m) => m.metric_key === r.key)?.hide_if_missing));
  const chartData = visible.map((r) => ({
    axis: r.label,
    athlete: r.missing ? 0 : (r.normalized ?? 0),
    baseline: r.groupMedian ?? 50,
    _raw: r.raw,
    _unit: r.unit,
    _missing: r.missing,
    _color: dotColorFor(r.normalized ?? 0),
  }));

  return (
    <Card
      className="overflow-hidden border-border/60"
      style={{
        background:
          "radial-gradient(ellipse at 50% 0%, color-mix(in oklab, var(--neon-accent) 12%, var(--card)) 0%, var(--card) 65%)",
      }}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-baseline sm:justify-between">
          <div className="min-w-0">
            <div className="eyebrow" style={{ color: "oklch(0.82 0.17 85)" }}>Physicality percentiles</div>
            <div className="mt-1 truncate text-sm text-foreground">
              {template.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {labelFor(template.normalization_method)} · {labelFor(template.date_rule)}
              </span>
            </div>
          </div>
          {canEdit && (
            <Link
              to="/dashboard-settings"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              <Settings2 className="h-3 w-3" /> Configure
            </Link>
          )}
        </div>

        {chartData.length < 3 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            Add at least 3 metrics to this template to render the radar.
          </p>
        ) : (
          <div className="mt-4 h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={chartData} outerRadius="70%" margin={{ top: 24, right: 40, bottom: 24, left: 40 }}>
                <defs>
                  <radialGradient id="spiderFill" cx="50%" cy="50%" r="70%">
                    <stop offset="0%"   stopColor="oklch(0.82 0.17 85)" stopOpacity={0.10} />
                    <stop offset="100%" stopColor="oklch(0.82 0.17 85)" stopOpacity={0.02} />
                  </radialGradient>
                </defs>
                <PolarGrid stroke="color-mix(in oklab, var(--foreground) 12%, transparent)" />
                <PolarAngleAxis
                  dataKey="axis"
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 11, fontWeight: 500 }}
                  tickLine={false}
                />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar
                  name="Group median"
                  dataKey="baseline"
                  stroke="oklch(0.78 0.06 300)"
                  strokeOpacity={0.7}
                  strokeDasharray="4 4"
                  strokeWidth={1.2}
                  fill="oklch(0.78 0.06 300)"
                  fillOpacity={0.04}
                  dot={{ r: 2.5, fill: "oklch(0.86 0.05 300)", stroke: "oklch(0.78 0.06 300)", strokeWidth: 1 }}
                />
                <Radar
                  name="Athlete"
                  dataKey="athlete"
                  stroke="oklch(0.82 0.17 85)"
                  strokeWidth={2.4}
                  fill="url(#spiderFill)"
                  dot={(props: { cx?: number; cy?: number; index?: number; payload?: { _color?: string } }) => {
                    const { cx, cy, index, payload } = props;
                    if (cx == null || cy == null) return <g key={index} />;
                    const color = payload?._color ?? "oklch(0.82 0.17 85)";
                    return (
                      <g key={index}>
                        <circle cx={cx} cy={cy} r={7} fill={color} opacity={0.25} />
                        <circle cx={cx} cy={cy} r={4} fill={color} stroke="oklch(0.98 0.01 90)" strokeWidth={1} />
                      </g>
                    );
                  }}
                  style={{ filter: "drop-shadow(0 0 6px oklch(0.82 0.17 85 / 0.45))" }}
                  isAnimationActive={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid color-mix(in oklab, oklch(0.82 0.17 85) 40%, var(--color-border))",
                    borderRadius: 8,
                    color: "var(--color-popover-foreground)",
                    fontSize: 12,
                    boxShadow: "0 8px 24px -8px oklch(0.82 0.17 85 / 0.35)",
                  }}
                  formatter={(v: number, name: string, entry: { payload?: { _raw?: number; _unit?: string; _missing?: boolean } }) => {
                    const p = entry.payload ?? {};
                    if (name === "Athlete") {
                      if (p._missing) return ["No data", "Athlete"];
                      return [`${v} / 100${p._raw != null ? ` · ${p._raw.toFixed(2)}${p._unit ?? ""}` : ""}`, "Athlete"];
                    }
                    return [`${v} / 100`, name];
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Peer-group filter */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="eyebrow">Compare vs.</span>
          <Select
            value={effectiveGroup ?? "team"}
            onValueChange={(v) => setGroupOverride(v as SpiderComparisonGroup)}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs">
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
          <div className="ml-auto flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: "oklch(0.78 0.19 145)" }} /> High
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: "oklch(0.82 0.17 95)" }} /> Mid
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: "oklch(0.86 0.05 300)" }} /> Peer
            </span>
          </div>
        </div>

        {rows.some((r) => r.missing) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {rows.filter((r) => r.missing).map((r) => (
              <Badge key={r.key} variant="outline" className="text-[10px]">
                No data · {r.label}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function labelFor(v: string) {
  return v.replace(/_/g, " ");
}
