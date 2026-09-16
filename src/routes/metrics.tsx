import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { customMetricsQO, exercisesQO, type CustomMetric, type MetricVariable } from "@/lib/queries";
import { TEST_TYPES } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, X, Check, ChevronsUpDown } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";

export const Route = createFileRoute("/metrics")({
  head: () => ({ meta: [{ title: "Custom Metrics — Strength Lab" }] }),
  component: MetricsPage,
});

type FormState = {
  name: string; description: string;
  kind: CustomMetric["kind"];
  test_type: string; numerator_test: string; denominator_test: string;
  exercise_name: string; since_days: string;
  formula: string; variables: MetricVariable[];
  lower_is_better: boolean; unit: string;
  measurement: "load" | "time" | "height";
};

const EMPTY: FormState = {
  name: "", description: "", kind: "test_value",
  test_type: "", numerator_test: "", denominator_test: "",
  exercise_name: "", since_days: "30",
  formula: "", variables: [],
  lower_is_better: false, unit: "",
  measurement: "load",
};


const METRIC_CATEGORIES: {
  id: string; label: string; hint: string;
  kind: CustomMetric["kind"]; measurement?: "load" | "time" | "height";
}[] = [
  { id: "lift", label: "Lift (weight)", hint: "Best load logged on an exercise — e.g. Back Squat 1RM.", kind: "lift_max", measurement: "load" },
  { id: "speed", label: "Speed / time", hint: "Fastest time logged on an exercise — lower is better.", kind: "lift_max", measurement: "time" },
  { id: "jump", label: "Jump / distance", hint: "Best height or distance logged on an exercise.", kind: "lift_max", measurement: "height" },
  { id: "test", label: "Test result", hint: "Best value from a recorded test type.", kind: "test_value" },
  { id: "bw", label: "Bodyweight-adjusted", hint: "Test value divided by bodyweight^⅔.", kind: "bw_coefficient" },
  { id: "ratio", label: "Ratio of two tests", hint: "One test divided by another.", kind: "ratio" },
  { id: "improve", label: "% improvement", hint: "Change from first to latest result on a test.", kind: "improvement_pct" },
  { id: "attendance", label: "Attendance %", hint: "Sessions attended over a rolling window.", kind: "attendance_pct" },
  { id: "formula", label: "Custom formula", hint: "Build your own expression from any data source.", kind: "formula" },
];

const ATHLETE_FIELDS = [
  { key: "bodyweight", label: "Bodyweight (lb)" },
  { key: "height_in", label: "Height (in)" },
  { key: "grade", label: "Grade" },
  { key: "graduation_year", label: "Graduation year" },
];

function MetricsPage() {
  const qc = useQueryClient();
  const { data: metrics = [] } = useQuery(customMetricsQO);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomMetric | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<CustomMetric | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      if (form.kind === "formula") {
        if (!form.formula.trim()) throw new Error("Formula is required");
        const names = new Set<string>();
        for (const v of form.variables) {
          if (!v.name.trim()) throw new Error("Every variable needs a name");
          if (names.has(v.name)) throw new Error(`Duplicate variable: ${v.name}`);
          names.add(v.name);
          if (!v.key) throw new Error(`Variable "${v.name}" needs a data source`);
        }
      }
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        kind: form.kind,
        test_type: (form.kind === "test_value" || form.kind === "bw_coefficient" || form.kind === "improvement_pct") ? (form.test_type || null) : null,
        numerator_test: form.kind === "ratio" ? (form.numerator_test || null) : null,
        denominator_test: form.kind === "ratio" ? (form.denominator_test || null) : null,
        exercise_name: form.kind === "lift_max" ? (form.exercise_name.trim() || null) : null,
        since_days: form.kind === "attendance_pct" ? (Number(form.since_days) || 30) : null,
        formula: form.kind === "formula" ? form.formula.trim() : null,
        variables: form.kind === "formula" ? form.variables : [],
        lower_is_better: form.kind === "lift_max" && form.measurement === "time" ? true : form.lower_is_better,
        unit: form.unit.trim() || (form.kind === "lift_max" ? (form.measurement === "time" ? "s" : form.measurement === "height" ? "in" : "lb") : null),
        measurement: form.kind === "lift_max" ? form.measurement : "load",
      };

      if (editing) {
        const { error } = await supabase.from("custom_metrics").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const organization_id = await getScopedOrgId();
        const { error } = await supabase.from("custom_metrics").insert({ ...payload, organization_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom_metrics"] });
      toast.success(editing ? "Metric updated" : "Metric added");
      setOpen(false); setEditing(null); setForm(EMPTY);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("custom_metrics").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["custom_metrics"] }); toast.success("Removed"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const openEdit = (m: CustomMetric) => {
    setEditing(m);
    setForm({
      name: m.name, description: m.description ?? "", kind: m.kind,
      test_type: m.test_type ?? "", numerator_test: m.numerator_test ?? "",
      denominator_test: m.denominator_test ?? "",
      exercise_name: m.exercise_name ?? "",
      since_days: m.since_days != null ? String(m.since_days) : "30",
      formula: m.formula ?? "", variables: m.variables ?? [],
      lower_is_better: m.lower_is_better, unit: m.unit ?? "",
      measurement: (m.measurement ?? "load") as "load" | "time" | "height",

    });
    setOpen(true);
  };

  const describe = (m: CustomMetric) => {
    const label = (v: string | null) => TEST_TYPES.find((t) => t.value === v)?.label ?? v ?? "?";
    if (m.kind === "test_value") return `Best ${label(m.test_type)}`;
    if (m.kind === "bw_coefficient") return `${label(m.test_type)} / bodyweight^(2/3)`;
    if (m.kind === "ratio") return `${label(m.numerator_test)} ÷ ${label(m.denominator_test)}`;
    if (m.kind === "lift_max") {
      const axis = (m.measurement ?? "load") === "time" ? "best time" : (m.measurement ?? "load") === "height" ? "best height" : "best load";
      return `${axis}: ${m.exercise_name ?? "?"}`;
    }

    if (m.kind === "attendance_pct") return `Attendance % over last ${m.since_days ?? 30} days`;
    if (m.kind === "improvement_pct") return `% improvement in ${label(m.test_type)}`;
    if (m.kind === "formula") return m.formula ?? "custom formula";
    return "";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Custom Metrics</h1>
          <p className="text-sm text-muted-foreground">{metrics.length} metric{metrics.length === 1 ? "" : "s"} · define once, use anywhere</p>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setForm(EMPTY); setOpen(true); }}>
          <Plus className="h-4 w-4" /> New metric
        </Button>
      </div>

      {metrics.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No metrics yet. Start with something like "Relative Squat" (Back Squat 1RM ÷ bodyweight²ᐟ³) or "Speed-Strength Ratio" (Vertical Jump ÷ Squat 1RM).
        </CardContent></Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((m) => (
            <Card key={m.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{m.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="secondary">{m.kind.replace("_", " ")}</Badge>
                      {m.lower_is_better && <Badge variant="outline">lower is better</Badge>}
                      {m.unit && <Badge variant="outline">{m.unit}</Badge>}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{describe(m)}</p>
                    {m.description && <p className="mt-1 text-xs text-muted-foreground">{m.description}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(m)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(m)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit metric" : "New custom metric"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Relative Squat" /></div>
            <div>
              <Label>What kind of metric is this?</Label>
              <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {METRIC_CATEGORIES.map((c) => {
                  const active = form.kind === c.kind && (c.kind !== "lift_max" || form.measurement === c.measurement);
                  return (
                    <Button
                      key={c.id}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      className="h-auto justify-start whitespace-normal py-2 text-left text-xs"
                      onClick={() => setForm({
                        ...form,
                        kind: c.kind,
                        measurement: c.measurement ?? form.measurement,
                        lower_is_better: c.measurement === "time" ? true : form.lower_is_better,
                      })}
                    >
                      {c.label}
                    </Button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{METRIC_CATEGORIES.find((c) => c.kind === form.kind && (c.kind !== "lift_max" || c.measurement === form.measurement))?.hint ?? ""}</p>
            </div>


            {(form.kind === "test_value" || form.kind === "bw_coefficient" || form.kind === "improvement_pct") && (
              <div>
                <Label>Test</Label>
                <Select value={form.test_type} onValueChange={(v) => setForm({ ...form, test_type: v })}>
                  <SelectTrigger><SelectValue placeholder="Choose test…" /></SelectTrigger>
                  <SelectContent>
                    {TEST_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.kind === "ratio" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Numerator</Label>
                  <Select value={form.numerator_test} onValueChange={(v) => setForm({ ...form, numerator_test: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {TEST_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Denominator</Label>
                  <Select value={form.denominator_test} onValueChange={(v) => setForm({ ...form, denominator_test: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {TEST_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {form.kind === "lift_max" && (
              <div className="grid grid-cols-[2fr_1fr] gap-3">
                <div>
                  <Label>Exercise</Label>
                  <ExercisePicker
                    value={form.exercise_name}
                    onChange={(name, measurement) =>
                      setForm({
                        ...form,
                        exercise_name: name,
                        ...(measurement
                          ? { measurement, lower_is_better: measurement === "time" }
                          : {}),
                      })
                    }
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Linked to your Exercise Library — matches lifts and workout logs by name.
                  </p>
                </div>
                <div>
                  <Label>Rank by</Label>
                  <Select value={form.measurement} onValueChange={(v) => setForm({ ...form, measurement: v as "load" | "time" | "height", lower_is_better: v === "time" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="load">Load (lb)</SelectItem>
                      <SelectItem value="time">Time (s, lower better)</SelectItem>
                      <SelectItem value="height">Height / distance (in)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}


            {form.kind === "attendance_pct" && (
              <div>
                <Label>Rolling window (days)</Label>
                <Input type="number" min={1} max={365} value={form.since_days} onChange={(e) => setForm({ ...form, since_days: e.target.value })} />
              </div>
            )}

            {form.kind === "formula" && (
              <FormulaBuilder
                formula={form.formula}
                variables={form.variables}
                onFormulaChange={(formula) => setForm({ ...form, formula })}
                onVariablesChange={(variables) => setForm({ ...form, variables })}
              />
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Unit (optional)</Label>
                <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="lb, ratio, in…" />
              </div>
              <div className="flex items-end gap-2">
                <input id="lb" type="checkbox" checked={form.lower_is_better} onChange={(e) => setForm({ ...form, lower_is_better: e.target.checked })} />
                <Label htmlFor="lb" className="mb-1">Lower is better</Label>
              </div>
            </div>

            <div><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{editing ? "Save" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="This permanently removes the custom metric. This can't be undone."
        onConfirm={() => { if (deleteTarget) del.mutate(deleteTarget.id); setDeleteTarget(null); }}
        pending={del.isPending}
      />
    </div>
  );
}

/** Picks an exercise from the library (or a free-typed name) for a lift-based metric. */
function ExercisePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string, measurement?: "load" | "time" | "height") => void;
}) {
  const { data: exercises = [] } = useQuery(exercisesQO);
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
          <span className={value ? "truncate" : "truncate text-muted-foreground"}>
            {value || "Choose exercise…"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search exercises…"
            value={value}
            onValueChange={(v) => onChange(v)}
          />
          <CommandList>
            <CommandEmpty>Use "{value}" as a custom name.</CommandEmpty>
            <CommandGroup>
              {exercises.map((e) => (
                <CommandItem
                  key={e.id}
                  value={`${e.name} ${e.category ?? ""}`}
                  onSelect={() => {
                    const mt = e.measurement_type ?? "load";
                    onChange(
                      e.name,
                      mt === "seconds" ? "time" : mt === "inches" ? "height" : "load",
                    );
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value === e.name ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  {e.category && (
                    <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">{e.category}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}


function FormulaBuilder({
  formula, variables, onFormulaChange, onVariablesChange,
}: {
  formula: string;
  variables: MetricVariable[];
  onFormulaChange: (v: string) => void;
  onVariablesChange: (v: MetricVariable[]) => void;
}) {
  const { data: exercises = [] } = useQuery(exercisesQO);
  const update = (i: number, patch: Partial<MetricVariable>) => {
    const next = variables.slice();
    next[i] = { ...next[i], ...patch };
    onVariablesChange(next);
  };
  const add = () => onVariablesChange([...variables, { name: `v${variables.length + 1}`, source: "athlete", key: "bodyweight" }]);
  const remove = (i: number) => onVariablesChange(variables.filter((_, j) => j !== i));

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">Variables</Label>
        <Button size="sm" variant="outline" onClick={add} type="button"><Plus className="h-3 w-3" /> Variable</Button>
      </div>
      {variables.length === 0 && (
        <p className="text-xs text-muted-foreground">Add variables you'll reference in the formula (e.g. <span className="font-mono">bw</span>, <span className="font-mono">squat</span>).</p>
      )}
      <div className="space-y-2">
        {variables.map((v, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2">
            <Input placeholder="name" value={v.name} onChange={(e) => update(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} />
            <Select value={v.source} onValueChange={(val) => update(i, { source: val as MetricVariable["source"], key: "" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="athlete">Athlete field</SelectItem>
                <SelectItem value="test">Test (best)</SelectItem>
                <SelectItem value="lift">Lift (best load)</SelectItem>
              </SelectContent>
            </Select>
            {v.source === "athlete" ? (
              <Select value={v.key} onValueChange={(val) => update(i, { key: val })}>
                <SelectTrigger><SelectValue placeholder="Field" /></SelectTrigger>
                <SelectContent>
                  {ATHLETE_FIELDS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : v.source === "test" ? (
              <Select value={v.key} onValueChange={(val) => update(i, { key: val })}>
                <SelectTrigger><SelectValue placeholder="Test" /></SelectTrigger>
                <SelectContent>
                  {TEST_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Select value={v.key} onValueChange={(val) => update(i, { key: val })}>
                <SelectTrigger><SelectValue placeholder="Exercise" /></SelectTrigger>
                <SelectContent>
                  {exercises.map((e) => <SelectItem key={e.id} value={e.name}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Button size="icon" variant="ghost" onClick={() => remove(i)} type="button"><X className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
      <div>
        <Label className="text-sm">Formula</Label>
        <Textarea
          rows={2}
          value={formula}
          onChange={(e) => onFormulaChange(e.target.value)}
          placeholder="sqrt(squat) * bw / 100"
          className="font-mono text-sm"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Use variable names above. Operators: <span className="font-mono">+ - * / ^ ( )</span>.
          Functions: <span className="font-mono">sqrt, abs, min, max, log, exp, round, floor, ceil, pow</span>.
        </p>
      </div>
    </div>
  );
}
