import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { exercisesQO, exerciseRelationshipsQO, type Exercise, type ExerciseRelationship } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, Pencil, Trash2, Link2, X, GitMerge, Dumbbell } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { PageSkeleton } from "@/components/loading";
import { toast } from "sonner";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import { z } from "zod";
import { LiftsPanel } from "@/components/lifts-panel";

export const Route = createFileRoute("/exercises")({
  head: () => ({ meta: [{ title: "Exercises & Lifts — Strength Lab" }] }),
  validateSearch: z.object({ tab: z.enum(["library", "lifts"]).optional() }),
  component: ExercisesAndLiftsPage,
});

function ExercisesAndLiftsPage() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const active = tab ?? "library";
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Library"
        title="Exercises & Lifts"
        description="Manage your exercise library and log athlete lifts in one place."
      />
      <Tabs value={active} onValueChange={(v) => navigate({ search: { tab: v as "library" | "lifts" } })}>
        <TabsList>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="lifts">Lifts</TabsTrigger>
        </TabsList>
        <TabsContent value="library" className="mt-4"><ExerciseLibraryPanel /></TabsContent>
        <TabsContent value="lifts" className="mt-4"><LiftsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}


const CATEGORIES = ["Lift", "Jumps", "Plyometrics", "Speed", "Accessory", "Warm-Up"];

function measurementLabel(t: string) {
  return t === "seconds" ? "Seconds" : t === "inches" ? "Inches" : t === "reps" ? "Reps" : t === "mph" ? "Speed (mph)" : "Load (lb)";
}

function ExerciseLibraryPanel() {
  const qc = useQueryClient();
  const { data: exercises = [], isLoading } = useQuery(exercisesQO);
  const { data: rels = [] } = useQuery(exerciseRelationshipsQO);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [form, setForm] = useState({ name: "", category: "", video_url: "", image_url: "", measurement_type: "load" as "load" | "seconds" | "inches" | "reps" | "mph", is_metric: false });
  const [linkFor, setLinkFor] = useState<Exercise | null>(null);
  const [mergeFor, setMergeFor] = useState<Exercise | null>(null);

  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  const filtered = useMemo(() => exercises.filter((e) => {
    if (category !== "all" && e.category !== category) return false;
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [exercises, search, category]);

  const relsFor = (exId: string) => rels.filter((r) => r.from_exercise_id === exId || r.to_exercise_id === exId);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      const payload = {
        name: form.name.trim(),
        category: form.category || null,
        video_url: form.video_url.trim() || null,
        image_url: form.image_url.trim() || null,
        measurement_type: form.measurement_type,
        is_metric: form.is_metric,
        is_custom: true,
      };
      if (editing) {
        const { error } = await supabase.from("exercises").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const organization_id = await getScopedOrgId();
        const { error } = await supabase.from("exercises").insert({ ...payload, organization_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exercises"] });
      toast.success(editing ? "Exercise updated" : "Exercise added");
      setOpen(false); setEditing(null);
      setForm({ name: "", category: "", video_url: "", image_url: "", measurement_type: "load", is_metric: false });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("exercises").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["exercises"] }); toast.success("Removed"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const openEdit = (e: Exercise) => {
    setEditing(e);
    setForm({
      name: e.name, category: e.category ?? "",
      video_url: e.video_url ?? "", image_url: e.image_url ?? "",
      measurement_type: e.measurement_type ?? "load", is_metric: e.is_metric ?? false,
    });
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">{filtered.length} of {exercises.length} exercises · {rels.length} relationships</p>
        <Button size="sm" onClick={() => { setEditing(null); setForm({ name: "", category: "", video_url: "", image_url: "", measurement_type: "load", is_metric: false }); setOpen(true); }}>
          <Plus className="h-4 w-4" /> Custom exercise
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_200px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search exercises…" className="pl-9" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <PageSkeleton variant="grid" rows={6} className="!mb-0" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Dumbbell}
          title={exercises.length === 0 ? "Your library is empty" : "No exercises match this filter"}
          description={
            exercises.length === 0
              ? "Add a custom exercise to start building workouts and tracking lifts."
              : "Try a different category or clear the search."
          }
          action={
            exercises.length === 0 ? (
              <Button size="sm" onClick={() => { setEditing(null); setForm({ name: "", category: "", video_url: "", image_url: "", measurement_type: "load", is_metric: false }); setOpen(true); }}>
                <Plus className="h-4 w-4" /> Custom exercise
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => {
            const linked = relsFor(e.id);
            return (
              <Card key={e.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{e.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {e.category && <Badge variant="secondary">{e.category}</Badge>}
                        <Badge variant="outline">{measurementLabel(e.measurement_type)}</Badge>
                        {e.is_metric && <Badge variant="secondary">Metric</Badge>}
                        {e.is_custom && <Badge>Custom</Badge>}
                      </div>
                      
                      {e.video_url && <a href={e.video_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-primary underline">Video demo</a>}
                      {linked.length > 0 && (
                        <div className="mt-2 space-y-0.5 border-t pt-2">
                          {linked.map((r) => {
                            const isFrom = r.from_exercise_id === e.id;
                            const other = byId.get(isFrom ? r.to_exercise_id : r.from_exercise_id);
                            const pct = Math.round((isFrom ? r.ratio : 1 / r.ratio) * 100);
                            return (
                              <div key={r.id} className="text-xs text-muted-foreground">
                                ≈ <span className="font-mono">{pct}%</span> of {other?.name ?? "?"}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button size="icon" variant="ghost" title="Manage relationships" onClick={() => setLinkFor(e)}><Link2 className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" title="Merge into another exercise" onClick={() => setMergeFor(e)}><GitMerge className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(e)}><Pencil className="h-4 w-4" /></Button>
                      {e.is_custom && (
                        <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Delete ${e.name}?`)) del.mutate(e.id); }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit exercise" : "New custom exercise"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Measured in</Label>
                <Select value={form.measurement_type} onValueChange={(v) => setForm({ ...form, measurement_type: v as typeof form.measurement_type })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="load">Load (lb)</SelectItem>
                    <SelectItem value="seconds">Seconds</SelectItem>
                    <SelectItem value="inches">Inches</SelectItem>
                    <SelectItem value="reps">Reps</SelectItem>
                    <SelectItem value="mph">Speed (mph)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-1">
                <input
                  id="is_metric"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.is_metric}
                  onChange={(e) => setForm({ ...form, is_metric: e.target.checked })}
                />
                <Label htmlFor="is_metric" className="cursor-pointer">Use as a metric (leaderboards, tracking)</Label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Video URL</Label><Input value={form.video_url} onChange={(e) => setForm({ ...form, video_url: e.target.value })} placeholder="https://…" /></div>
              <div><Label>Image URL</Label><Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://…" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{editing ? "Save" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RelationshipsDialog
        exercise={linkFor}
        onClose={() => setLinkFor(null)}
        exercises={exercises}
        rels={rels}
      />
      <MergeDialog
        exercise={mergeFor}
        onClose={() => setMergeFor(null)}
        exercises={exercises}
      />
    </div>
  );
}

function MergeDialog({
  exercise, onClose, exercises,
}: {
  exercise: Exercise | null;
  onClose: () => void;
  exercises: Exercise[];
}) {
  const qc = useQueryClient();
  const [primaryId, setPrimaryId] = useState("");
  const [search, setSearch] = useState("");

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return exercises
      .filter((e) => e.id !== exercise?.id)
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [exercises, search, exercise?.id]);

  const primary = exercises.find((e) => e.id === primaryId);

  const merge = useMutation({
    mutationFn: async () => {
      if (!exercise || !primaryId) throw new Error("Pick a primary exercise");
      const { error } = await supabase.rpc("merge_exercises", {
        _alias_id: exercise.id,
        _primary_id: primaryId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exercises"] });
      qc.invalidateQueries({ queryKey: ["exercise_relationships"] });
      qc.invalidateQueries({ queryKey: ["lifts"] });
      qc.invalidateQueries({ queryKey: ["rep_maxes"] });
      toast.success(`Merged into ${primary?.name}`);
      setPrimaryId(""); setSearch("");
      onClose();
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <Dialog open={!!exercise} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Merge · {exercise?.name}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Combine duplicates into one. All workouts, rep maxes, and lifts pointing at{" "}
          <span className="font-medium">{exercise?.name}</span> will be repointed to the exercise you pick below,
          and <span className="font-medium">{exercise?.name}</span> will be removed. This cannot be undone.
        </p>
        <div className="space-y-2">
          <Label className="text-xs">Search primary exercise</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Bench Press" />
          <div className="max-h-64 space-y-1 overflow-y-auto rounded border p-1">
            {candidates.length === 0 && (
              <div className="p-2 text-xs text-muted-foreground">No matches.</div>
            )}
            {candidates.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setPrimaryId(e.id)}
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${primaryId === e.id ? "bg-muted" : ""}`}
              >
                <span>{e.name}</span>
                {e.category && <Badge variant="secondary" className="ml-2">{e.category}</Badge>}
              </button>
            ))}
          </div>
          {primary && (
            <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs">
              Merge <span className="font-medium">{exercise?.name}</span> →{" "}
              <span className="font-medium">{primary.name}</span>. {exercise?.name} will be deleted.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (!primary) return;
              if (confirm(`Merge "${exercise?.name}" into "${primary.name}"? This cannot be undone.`)) {
                merge.mutate();
              }
            }}
            disabled={!primaryId || merge.isPending}
          >
            {merge.isPending ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RelationshipsDialog({
  exercise, onClose, exercises, rels,
}: {
  exercise: Exercise | null;
  onClose: () => void;
  exercises: Exercise[];
  rels: ExerciseRelationship[];
}) {
  const qc = useQueryClient();
  const [target, setTarget] = useState("");
  const [pct, setPct] = useState("80");
  const [notes, setNotes] = useState("");

  const mine = exercise ? rels.filter((r) => r.from_exercise_id === exercise.id || r.to_exercise_id === exercise.id) : [];
  const byId = new Map(exercises.map((e) => [e.id, e]));

  const add = useMutation({
    mutationFn: async () => {
      if (!exercise) return;
      if (!target) throw new Error("Pick a related exercise");
      const ratio = Number(pct) / 100;
      if (!ratio || ratio <= 0) throw new Error("Ratio must be > 0");
      // "current exercise ≈ pct% of target" → from = current, to = target
      const { error } = await supabase.from("exercise_relationships").insert({
        from_exercise_id: exercise.id, to_exercise_id: target, ratio, notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exercise_relationships"] });
      toast.success("Linked");
      setTarget(""); setPct("80"); setNotes("");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("exercise_relationships").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["exercise_relationships"] }); },
  });

  return (
    <Dialog open={!!exercise} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Relationships · {exercise?.name}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Link exercises with a ratio so the app can estimate a max from a related lift when an athlete
          hasn't logged the exact one. Example: <span className="font-mono">Front Squat ≈ 80% of Back Squat</span>.
        </p>

        <div className="space-y-2">
          {mine.length === 0 && <p className="text-sm text-muted-foreground">No relationships yet.</p>}
          {mine.map((r) => {
            const isFrom = r.from_exercise_id === exercise?.id;
            const other = byId.get(isFrom ? r.to_exercise_id : r.from_exercise_id);
            const displayPct = Math.round((isFrom ? r.ratio : 1 / r.ratio) * 100);
            return (
              <div key={r.id} className="flex items-center justify-between rounded border p-2 text-sm">
                <div>
                  <span className="font-medium">{exercise?.name}</span>
                  <span className="text-muted-foreground"> ≈ </span>
                  <span className="font-mono">{displayPct}%</span>
                  <span className="text-muted-foreground"> of </span>
                  <span className="font-medium">{other?.name ?? "?"}</span>
                  {r.notes && <div className="text-xs text-muted-foreground">{r.notes}</div>}
                </div>
                <Button size="icon" variant="ghost" onClick={() => del.mutate(r.id)}><X className="h-4 w-4" /></Button>
              </div>
            );
          })}
        </div>

        <div className="space-y-2 border-t pt-3">
          <div className="text-sm font-medium">Add relationship</div>
          <div className="grid grid-cols-[1fr_100px] gap-2">
            <div>
              <Label className="text-xs">Related exercise</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {exercises.filter((e) => e.id !== exercise?.id).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">% of related</Label>
              <Input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. based on team averages" />
          </div>
          <div className="text-xs text-muted-foreground">
            Reads as: <span className="font-mono">{exercise?.name || "This lift"} ≈ {pct || "?"}% of {byId.get(target)?.name || "related lift"}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={() => add.mutate()} disabled={add.isPending || !target}>Add link</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
