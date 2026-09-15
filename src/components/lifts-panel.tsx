import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { athletesQO, liftsQO, liftSetsQO } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { Filters, emptyFilters, filterAthletes, inDateRange } from "@/components/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Download, Trash2, X, Pencil } from "lucide-react";
import { bwCoefficient, downloadCSV } from "@/lib/domain";
import { toast } from "sonner";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import { AthleteCombobox } from "@/components/athlete-combobox";

const COMMON_LIFTS = ["Back Squat", "Front Squat", "Bench Press", "Deadlift", "Power Clean", "Hang Clean", "Snatch", "Push Press", "Romanian Deadlift", "Bulgarian Split Squat"];

type FormSet = { load: string; reps: string; velocity: string };

function emptySet(): FormSet {
  return { load: "", reps: "", velocity: "" };
}

export function LiftsPanel() {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: lifts = [] } = useQuery(liftsQO);
  const { data: liftSets = [] } = useQuery(liftSetsQO);
  const [filters, setFilters] = useState(emptyFilters);
  const [exerciseFilter, setExerciseFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    athlete_id: "", exercise: "Back Squat",
    lift_date: new Date().toISOString().slice(0, 10),
    notes: "",
    sets: [emptySet()] as FormSet[],
  });

  const byId = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes]);
  const scopedIds = useMemo(() => new Set(filterAthletes(athletes, filters).map((a) => a.id)), [athletes, filters]);
  const exercises = useMemo(() => Array.from(new Set(lifts.map((l) => l.exercise))).sort(), [lifts]);
  const setsByLift = useMemo(() => {
    const m = new Map<string, typeof liftSets>();
    for (const s of liftSets) {
      const arr = m.get(s.lift_id) ?? [];
      arr.push(s);
      m.set(s.lift_id, arr);
    }
    return m;
  }, [liftSets]);

  const filtered = useMemo(() => lifts.filter((l) => {
    if (!scopedIds.has(l.athlete_id)) return false;
    if (exerciseFilter !== "all" && l.exercise !== exerciseFilter) return false;
    if (!inDateRange(l.lift_date, filters)) return false;
    return true;
  }), [lifts, scopedIds, exerciseFilter, filters]);

  const resetForm = () => setForm({
    athlete_id: form.athlete_id, exercise: form.exercise,
    lift_date: form.lift_date, notes: "", sets: [emptySet()],
  });

  const openNew = () => {
    setEditingId(null);
    resetForm();
    setOpen(true);
  };

  const openEdit = (liftId: string) => {
    const l = lifts.find((x) => x.id === liftId);
    if (!l) return;
    const setRows = (setsByLift.get(liftId) ?? []).slice().sort((a, b) => a.position - b.position);
    const formSets: FormSet[] = setRows.length
      ? setRows.map((s) => ({
          load: s.load != null ? String(s.load) : "",
          reps: s.reps != null ? String(s.reps) : "",
          velocity: s.velocity != null ? String(s.velocity) : "",
        }))
      : [{
          load: l.load != null ? String(l.load) : "",
          reps: l.reps != null ? String(l.reps) : "",
          velocity: l.velocity != null ? String(l.velocity) : "",
        }];
    setForm({
      athlete_id: l.athlete_id,
      exercise: l.exercise,
      lift_date: l.lift_date,
      notes: l.notes ?? "",
      sets: formSets,
    });
    setEditingId(liftId);
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.athlete_id) throw new Error("Select an athlete");
      if (!form.exercise.trim()) throw new Error("Exercise is required");
      const parsedSets = form.sets
        .map((s) => ({
          load: s.load ? Number(s.load) : null,
          reps: s.reps ? Number(s.reps) : null,
          velocity: s.velocity ? Number(s.velocity) : null,
        }))
        .filter((s) => s.load != null || s.reps != null || s.velocity != null);
      if (!parsedSets.length) throw new Error("Add at least one set with values");

      const topLoad = parsedSets.reduce<number | null>((m, s) => (s.load != null && (m == null || s.load > m) ? s.load : m), null);
      const topLoadSet = parsedSets.find((s) => s.load === topLoad) ?? parsedSets[0];

      const organization_id = await getScopedOrgId();
      const liftPayload = {
        organization_id,
        athlete_id: form.athlete_id, exercise: form.exercise.trim(),
        load: topLoad,
        sets: parsedSets.length,
        reps: topLoadSet.reps ?? null,
        velocity: topLoadSet.velocity ?? null,
        lift_date: form.lift_date, notes: form.notes.trim() || null,
      };

      let liftId: string;
      if (editingId) {
        const { error } = await supabase.from("lifts").update(liftPayload).eq("id", editingId);
        if (error) throw error;
        const { error: delErr } = await supabase.from("lift_sets").delete().eq("lift_id", editingId);
        if (delErr) throw delErr;
        liftId = editingId;
      } else {
        const { data: liftRow, error } = await supabase.from("lifts").insert(liftPayload).select("id").single();
        if (error) throw error;
        liftId = liftRow.id;
      }

      const rows = parsedSets.map((s, i) => ({
        lift_id: liftId, position: i,
        load: s.load, reps: s.reps, velocity: s.velocity, notes: null,
      }));
      const { error: setErr } = await supabase.from("lift_sets").insert(rows);
      if (setErr) throw setErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lifts"] });
      qc.invalidateQueries({ queryKey: ["lift_sets"] });
      toast.success(editingId ? "Lift updated" : "Lift logged");
      setOpen(false);
      setEditingId(null);
      resetForm();
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("lifts").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lifts"] });
      qc.invalidateQueries({ queryKey: ["lift_sets"] });
      toast.success("Deleted");
    },
  });

  const exportCSV = () => {
    const rows: Record<string, unknown>[] = [];
    for (const l of filtered) {
      const a = byId.get(l.athlete_id);
      const setRows = setsByLift.get(l.id) ?? [];
      if (setRows.length) {
        setRows.forEach((s) => rows.push({
          date: l.lift_date, athlete: a?.name ?? "", sport: a?.sport ?? "",
          exercise: l.exercise, set: s.position + 1,
          load_lb: s.load ?? "", reps: s.reps ?? "", velocity_mps: s.velocity ?? "",
          bw_coefficient: bwCoefficient(s.load, a?.bodyweight)?.toFixed(3) ?? "",
          notes: l.notes ?? "",
        }));
      } else {
        rows.push({
          date: l.lift_date, athlete: a?.name ?? "", sport: a?.sport ?? "",
          exercise: l.exercise, set: 1,
          load_lb: l.load ?? "", reps: l.reps ?? "", velocity_mps: l.velocity ?? "",
          bw_coefficient: bwCoefficient(l.load, a?.bodyweight)?.toFixed(3) ?? "",
          notes: l.notes ?? "",
        });
      }
    }
    downloadCSV("lifts.csv", rows);
  };

  const updateSet = (i: number, patch: Partial<FormSet>) => {
    const next = form.sets.slice();
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, sets: next });
  };
  const addSet = () => {
    const last = form.sets[form.sets.length - 1];
    setForm({ ...form, sets: [...form.sets, last ? { ...last, velocity: "" } : emptySet()] });
  };
  const removeSet = (i: number) => {
    if (form.sets.length === 1) return;
    setForm({ ...form, sets: form.sets.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">Log each set with its own load, reps, and velocity.</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filtered.length}><Download className="h-4 w-4" /> CSV</Button>
          <Button size="sm" onClick={openNew} disabled={!athletes.length}><Plus className="h-4 w-4" /> Log lift</Button>
        </div>
      </div>

      <Filters value={filters} onChange={setFilters} athletes={athletes} />
      <div className="flex gap-2">
        <Select value={exerciseFilter} onValueChange={setExerciseFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Exercise" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All exercises</SelectItem>
            {exercises.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          {athletes.length === 0 ? "Add an athlete first." : "No lifts match your filters."}
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((l) => {
            const a = byId.get(l.athlete_id);
            const setRows = setsByLift.get(l.id) ?? [];
            const topLoad = l.load;
            const coef = bwCoefficient(topLoad, a?.bodyweight);
            return (
              <Card key={l.id}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{a?.name ?? "—"}</span>
                        <Badge variant="secondary">{l.exercise}</Badge>
                        <span className="text-xs text-muted-foreground">{l.lift_date}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {[
                          `${setRows.length || l.sets || 1} sets`,
                          coef != null ? `BW coef ${coef.toFixed(2)}` : null,
                          l.notes,
                        ].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="stat-number text-xl tabular-nums">
                        {topLoad ?? "—"}<span className="ml-1 text-sm text-muted-foreground">lb</span>
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => openEdit(l.id)} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => del.mutate(l.id)} aria-label="Delete"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                  {setRows.length > 0 && (
                    <div className="mt-2 grid gap-1 border-t pt-2 text-xs">
                      {setRows.map((s) => (
                        <div key={s.id} className="grid grid-cols-[40px_1fr_1fr_1fr] gap-2 tabular-nums">
                          <span className="text-muted-foreground">Set {s.position + 1}</span>
                          <span>{s.load != null ? `${s.load} lb` : "—"}</span>
                          <span>{s.reps != null ? `${s.reps} reps` : "—"}</span>
                          <span className={s.velocity != null ? "text-primary" : "text-muted-foreground"}>
                            {s.velocity != null ? `${s.velocity} m/s` : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Edit lift" : "Log a lift"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Athlete</Label>
              <AthleteCombobox athletes={athletes} value={form.athlete_id} onChange={(v) => setForm({ ...form, athlete_id: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Exercise</Label>
                <Input list="exercise-suggestions" value={form.exercise} onChange={(e) => setForm({ ...form, exercise: e.target.value })} />
                <datalist id="exercise-suggestions">
                  {[...new Set([...COMMON_LIFTS, ...exercises])].map((e) => <option key={e} value={e} />)}
                </datalist>
              </div>
              <div><Label>Date</Label><Input type="date" value={form.lift_date} onChange={(e) => setForm({ ...form, lift_date: e.target.value })} /></div>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/30 p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-muted-foreground">Sets</span>
                <Button size="sm" variant="ghost" onClick={addSet}><Plus className="h-3 w-3" /> Set</Button>
              </div>
              <div className="grid grid-cols-[24px_1fr_1fr_1fr_28px] items-center gap-2 text-[10px] uppercase text-muted-foreground">
                <span>#</span><span>Load (lb)</span><span>Reps</span><span>Velocity (m/s)</span><span></span>
              </div>
              {form.sets.map((s, i) => (
                <div key={i} className="grid grid-cols-[24px_1fr_1fr_1fr_28px] items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <Input className="h-8" inputMode="decimal" value={s.load} onChange={(e) => updateSet(i, { load: e.target.value })} />
                  <Input className="h-8" inputMode="numeric" value={s.reps} onChange={(e) => updateSet(i, { reps: e.target.value })} />
                  <Input className="h-8" inputMode="decimal" placeholder="opt." value={s.velocity} onChange={(e) => updateSet(i, { velocity: e.target.value })} />
                  <Button size="icon" variant="ghost" onClick={() => removeSet(i)} disabled={form.sets.length === 1} aria-label="Remove set">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div>
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{editingId ? "Save changes" : "Save lift"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
