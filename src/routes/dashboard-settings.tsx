import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import {
  spiderTemplatesQO, spiderMetricsQO, teamsQO, customMetricsQO, testTypesQO,
  type SpiderTemplate, type SpiderMetric,
  type SpiderComparisonGroup, type SpiderNormalizationMethod, type SpiderDateRule,
} from "@/lib/queries";
import { TEST_TYPES } from "@/lib/domain";
import { useMyPermissions } from "@/hooks/use-permissions";
import { useCurrentOrgId } from "@/hooks/use-current-org";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Star } from "lucide-react";

export const Route = createFileRoute("/dashboard-settings")({
  head: () => ({ meta: [{ title: "Dashboard Settings — Strength Lab" }] }),
  component: DashboardSettingsPage,
});

function DashboardSettingsPage() {
  const { data: perms, isLoading: permsLoading } = useMyPermissions();
  const orgId = useCurrentOrgId();
  const canEdit = perms?.roles.some((r) =>
    r === "owner" || r === "administrator" || r === "admin" || r === "coach" || r === "sport_coach",
  ) ?? false;

  const qc = useQueryClient();
  const { data: templates = [] } = useQuery(spiderTemplatesQO);
  const { data: metrics = [] } = useQuery(spiderMetricsQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: customMetrics = [] } = useQuery(customMetricsQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = templates.find((t) => t.id === selectedId) ?? templates[0] ?? null;
  const selectedMetrics = useMemo(
    () => selected ? metrics.filter((m) => m.template_id === selected.id).slice().sort((a, b) => a.position - b.position) : [],
    [metrics, selected],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["spider_graph_templates"] });
    qc.invalidateQueries({ queryKey: ["spider_graph_metrics"] });
  };

  const createTemplate = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No active organization");
      const { data, error } = await supabase
        .from("spider_graph_templates" as never)
        .insert({
          organization_id: orgId,
          name: `New template ${templates.length + 1}`,
          normalization_method: "percentile" as SpiderNormalizationMethod,
          comparison_group: "team" as SpiderComparisonGroup,
          date_rule: "latest" as SpiderDateRule,
          is_default: templates.length === 0,
        } as never)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as SpiderTemplate;
    },
    onSuccess: (t) => { invalidate(); setSelectedId(t.id); toast.success("Template created"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const updateTemplate = useMutation({
    mutationFn: async (patch: Partial<SpiderTemplate> & { id: string }) => {
      const { id, ...rest } = patch;
      const { error } = await supabase.from("spider_graph_templates" as never).update(rest as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Saved"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("spider_graph_templates" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setSelectedId(null); toast.success("Template deleted"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      if (!orgId) throw new Error("No org");
      await supabase.from("spider_graph_templates" as never).update({ is_default: false } as never).eq("organization_id", orgId);
      const { error } = await supabase.from("spider_graph_templates" as never).update({ is_default: true } as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Default set"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const addMetric = useMutation({
    mutationFn: async (metric_key: string) => {
      if (!selected) return;
      const position = (selectedMetrics[selectedMetrics.length - 1]?.position ?? 0) + 1;
      const { error } = await supabase.from("spider_graph_metrics" as never).insert({
        template_id: selected.id,
        metric_key,
        position,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const updateMetric = useMutation({
    mutationFn: async (patch: Partial<SpiderMetric> & { id: string }) => {
      const { id, ...rest } = patch;
      const { error } = await supabase.from("spider_graph_metrics" as never).update(rest as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const deleteMetric = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("spider_graph_metrics" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const moveMetric = (id: string, dir: -1 | 1) => {
    const idx = selectedMetrics.findIndex((m) => m.id === id);
    const other = selectedMetrics[idx + dir];
    if (!other) return;
    updateMetric.mutate({ id, position: other.position });
    updateMetric.mutate({ id: other.id, position: selectedMetrics[idx].position });
  };

  const availableMetricKeys = useMemo(() => {
    const existing = new Set(selectedMetrics.map((m) => m.metric_key));
    const opts: { key: string; label: string; group: string }[] = [];
    for (const t of TEST_TYPES) {
      const k = `test:${t.value}`;
      if (!existing.has(k)) opts.push({ key: k, label: t.label, group: "Standard tests" });
    }
    for (const c of customTypes) {
      const k = `test:${c.value}`;
      if (!existing.has(k)) opts.push({ key: k, label: c.label, group: "Custom tests" });
    }
    for (const c of customMetrics) {
      const k = `metric:${c.id}`;
      if (!existing.has(k)) opts.push({ key: k, label: c.name, group: "Custom metrics" });
    }
    return opts;
  }, [selectedMetrics, customTypes, customMetrics]);

  if (permsLoading) return <div className="py-16 text-center text-muted-foreground">Loading…</div>;

  if (!canEdit) {
    return (
      <div className="max-w-lg py-16 text-center">
        <h1 className="text-2xl font-semibold">Dashboard settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only owners, administrators, and coaches can configure the athlete preview.
        </p>
        <Link to="/" className="mt-4 inline-block text-primary underline">Back home</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Settings
          </Link>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Athlete preview settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure the spider graph and KPI dashboard shown on every athlete profile.
          </p>
        </div>
        <Button onClick={() => createTemplate.mutate()} disabled={!orgId || createTemplate.isPending}>
          <Plus className="mr-1 h-4 w-4" /> New template
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Template list */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Templates</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No templates yet. Create one to start.</p>
            ) : templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm ${
                  selected?.id === t.id ? "border-primary bg-muted" : "border-border hover:bg-muted/50"
                }`}
              >
                <span className="truncate">{t.name}</span>
                {t.is_default && <Star className="h-3 w-3 fill-primary text-primary" />}
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Template editor */}
        {selected ? (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Template details</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Name</Label>
                    <Input
                      defaultValue={selected.name}
                      key={selected.id + selected.name}
                      onBlur={(e) => e.target.value !== selected.name && updateTemplate.mutate({ id: selected.id, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Assigned team</Label>
                    <Select
                      value={selected.assignment?.team_id ?? "__all"}
                      onValueChange={(v) => updateTemplate.mutate({
                        id: selected.id,
                        assignment: { ...(selected.assignment ?? {}), team_id: v === "__all" ? null : v },
                      })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all">All teams</SelectItem>
                        {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Sport (optional)</Label>
                    <Input
                      defaultValue={selected.assignment?.sport ?? ""}
                      key={selected.id + (selected.assignment?.sport ?? "")}
                      placeholder="e.g. football"
                      onBlur={(e) => updateTemplate.mutate({
                        id: selected.id,
                        assignment: { ...(selected.assignment ?? {}), sport: e.target.value || null },
                      })}
                    />
                  </div>
                  <div>
                    <Label>Position (optional)</Label>
                    <Input
                      defaultValue={selected.assignment?.position ?? ""}
                      key={selected.id + (selected.assignment?.position ?? "")}
                      placeholder="e.g. WR"
                      onBlur={(e) => updateTemplate.mutate({
                        id: selected.id,
                        assignment: { ...(selected.assignment ?? {}), position: e.target.value || null },
                      })}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label>Normalization</Label>
                    <Select
                      value={selected.normalization_method}
                      onValueChange={(v) => updateTemplate.mutate({ id: selected.id, normalization_method: v as SpiderNormalizationMethod })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentile">Percentile in group</SelectItem>
                        <SelectItem value="pb_percent">% of personal best</SelectItem>
                        <SelectItem value="threshold">% of group best</SelectItem>
                        <SelectItem value="goal">Goal-based</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Comparison group</Label>
                    <Select
                      value={selected.comparison_group}
                      onValueChange={(v) => updateTemplate.mutate({ id: selected.id, comparison_group: v as SpiderComparisonGroup })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="team">Team</SelectItem>
                        <SelectItem value="sport">Sport</SelectItem>
                        <SelectItem value="grade">Grade</SelectItem>
                        <SelectItem value="position">Position</SelectItem>
                        <SelectItem value="org">Whole organization</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Date range</Label>
                    <Select
                      value={selected.date_rule}
                      onValueChange={(v) => updateTemplate.mutate({ id: selected.id, date_rule: v as SpiderDateRule })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="latest">Latest / career best</SelectItem>
                        <SelectItem value="season">This season</SelectItem>
                        <SelectItem value="last_90d">Last 90 days</SelectItem>
                        <SelectItem value="career">Career (no cutoff)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button size="sm" variant={selected.is_default ? "default" : "outline"} onClick={() => setDefault.mutate(selected.id)}>
                    <Star className="mr-1 h-3 w-3" /> {selected.is_default ? "Default template" : "Set as default"}
                  </Button>
                  <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => confirm("Delete template?") && deleteTemplate.mutate(selected.id)}>
                    <Trash2 className="mr-1 h-3 w-3" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Metrics (3–10)</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {selectedMetrics.length === 0 && (
                  <p className="text-sm text-muted-foreground">No metrics yet. Add at least 3 to render the radar.</p>
                )}
                <ul className="space-y-2">
                  {selectedMetrics.map((m, i) => (
                    <li key={m.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                      <div className="flex flex-col">
                        <button className="rounded p-0.5 hover:bg-muted disabled:opacity-30" disabled={i === 0} onClick={() => moveMetric(m.id, -1)}>
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button className="rounded p-0.5 hover:bg-muted disabled:opacity-30" disabled={i === selectedMetrics.length - 1} onClick={() => moveMetric(m.id, 1)}>
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{labelForKey(m.metric_key, customTypes, customMetrics)}</div>
                        <div className="text-[10px] text-muted-foreground">{m.metric_key}</div>
                      </div>
                      <Input
                        placeholder="Display label"
                        defaultValue={m.display_label ?? ""}
                        key={m.id + (m.display_label ?? "")}
                        onBlur={(e) => updateMetric.mutate({ id: m.id, display_label: e.target.value || null })}
                        className="w-40"
                      />
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Checkbox
                          checked={m.hide_if_missing}
                          onCheckedChange={(v) => updateMetric.mutate({ id: m.id, hide_if_missing: !!v })}
                        />
                        Hide if no data
                      </label>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteMetric.mutate(m.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </li>
                  ))}
                </ul>

                {selectedMetrics.length < 10 && (
                  <div className="border-t border-border pt-3">
                    <Label className="text-xs">Add metric</Label>
                    <Select onValueChange={(v) => addMetric.mutate(v)}>
                      <SelectTrigger><SelectValue placeholder="Choose a metric to add…" /></SelectTrigger>
                      <SelectContent>
                        {availableMetricKeys.map((o) => (
                          <SelectItem key={o.key} value={o.key}>
                            <span className="text-muted-foreground">{o.group} · </span>{o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Dashboard sections</CardTitle></CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-3">
                <SectionToggle
                  label="Show badges"
                  checked={selected.options?.show_badges ?? true}
                  onChange={(v) => updateTemplate.mutate({ id: selected.id, options: { ...(selected.options ?? {}), show_badges: v } })}
                />
                <SectionToggle
                  label="Show progress bars"
                  checked={selected.options?.show_progress ?? true}
                  onChange={(v) => updateTemplate.mutate({ id: selected.id, options: { ...(selected.options ?? {}), show_progress: v } })}
                />
                <SectionToggle
                  label="Show PR sections"
                  checked={selected.options?.show_prs ?? true}
                  onChange={(v) => updateTemplate.mutate({ id: selected.id, options: { ...(selected.options ?? {}), show_prs: v } })}
                />
                <SectionToggle
                  label="KPI sparklines"
                  checked={selected.kpi_config?.sparkline ?? true}
                  onChange={(v) => updateTemplate.mutate({ id: selected.id, kpi_config: { ...(selected.kpi_config ?? {}), sparkline: v } })}
                />
                <SectionToggle
                  label="Highlight PBs"
                  checked={selected.kpi_config?.highlight_pb ?? true}
                  onChange={(v) => updateTemplate.mutate({ id: selected.id, kpi_config: { ...(selected.kpi_config ?? {}), highlight_pb: v } })}
                />
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card><CardContent className="py-16 text-center text-muted-foreground">
            Create a template to begin.
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}

function SectionToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} />
      {label}
    </label>
  );
}

function labelForKey(
  key: string,
  customTypes: { value: string; label: string }[],
  customMetrics: { id: string; name: string }[],
) {
  const [kind, k] = key.split(":");
  if (kind === "test") {
    const t = TEST_TYPES.find((x) => x.value === k);
    if (t) return t.label;
    const c = customTypes.find((x) => x.value === k);
    if (c) return c.label;
    return k;
  }
  if (kind === "metric") {
    const c = customMetrics.find((x) => x.id === k);
    return c?.name ?? k;
  }
  return key;
}
