import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Icons from "lucide-react";
import { Award, Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { badgesQO, type Badge as BadgeType, type BadgeCriteria } from "@/lib/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { useCurrentOrgId } from "@/hooks/use-current-org";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/badges")({
  head: () => ({ meta: [{ title: "Badges — Strength Lab" }] }),
  component: BadgesAdmin,
});

const ICON_CHOICES = ["Award","Trophy","Medal","Star","Sparkles","Zap","Flame","Rocket","Activity","Dumbbell","ShieldCheck","CheckCircle2","TrendingUp","Target","Crown"];
const COLOR_CHOICES = [
  { value: "primary", label: "Primary" },
  { value: "accent", label: "Accent" },
  { value: "success", label: "Success" },
  { value: "destructive", label: "Destructive" },
  { value: "muted", label: "Muted" },
];
const colorMap: Record<string, string> = {
  primary: "bg-primary/15 text-primary ring-primary/30",
  accent: "bg-accent/15 text-accent-foreground ring-accent/30",
  success: "bg-emerald-500/15 text-emerald-500 ring-emerald-500/30",
  destructive: "bg-destructive/15 text-destructive ring-destructive/30",
  muted: "bg-muted text-muted-foreground ring-border",
};

function iconFor(name: string) {
  const I = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name];
  return I ?? Award;
}

type EditState = {
  id?: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  criteriaType: BadgeCriteria["type"];
  threshold: string;
  test_type: string;
  value: string;
  lower_is_better: boolean;
  exercise: string;
  load: string;
  ratio: string;
  count: string;
};

const EMPTY: EditState = {
  name: "", description: "", icon: "Award", color: "primary",
  criteriaType: "manual", threshold: "10", test_type: "", value: "",
  lower_is_better: false, exercise: "", load: "", ratio: "1.5", count: "5",
};

function BadgesAdmin() {
  const qc = useQueryClient();
  const orgId = useCurrentOrgId();
  const { data: badges = [] } = useQuery(badgesQO);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [open, setOpen] = useState(false);

  const mine = useMemo(() => badges.filter((b) => b.organization_id === orgId), [badges, orgId]);
  const global = useMemo(() => badges.filter((b) => b.organization_id == null), [badges]);

  const startNew = () => { setEditing({ ...EMPTY }); setOpen(true); };
  const startEdit = (b: BadgeType) => {
    const c = b.criteria;
    setEditing({
      id: b.id, name: b.name, description: b.description ?? "", icon: b.icon, color: b.color,
      criteriaType: c.type,
      threshold: "threshold" in c ? String(c.threshold) : "10",
      test_type: c.type === "test_threshold" ? c.test_type : "",
      value: c.type === "test_threshold" ? String(c.value) : "",
      lower_is_better: c.type === "test_threshold" ? !!c.lower_is_better : false,
      exercise: c.type === "lift_threshold" || c.type === "relative_strength_threshold" ? c.exercise : "",
      load: c.type === "lift_threshold" ? String(c.load) : "",
      ratio: c.type === "relative_strength_threshold" ? String(c.ratio) : "1.5",
      count: c.type === "pr_count" ? String(c.count) : "5",
    });
    setOpen(true);
  };

  const buildCriteria = (e: EditState): BadgeCriteria => {
    switch (e.criteriaType) {
      case "manual": return { type: "manual" };
      case "sessions_count": return { type: "sessions_count", threshold: Number(e.threshold) };
      case "attendance_pct": return { type: "attendance_pct", threshold: Number(e.threshold) };
      case "test_threshold": return { type: "test_threshold", test_type: e.test_type, value: Number(e.value), lower_is_better: e.lower_is_better };
      case "lift_threshold": return { type: "lift_threshold", exercise: e.exercise, load: Number(e.load) };
      case "relative_strength_threshold": return { type: "relative_strength_threshold", exercise: e.exercise, ratio: Number(e.ratio) };
      case "pr_count": return { type: "pr_count", count: Number(e.count) };
    }
  };

  const save = useMutation({
    mutationFn: async (e: EditState) => {
      if (!orgId) throw new Error("No organization");
      if (!e.name.trim()) throw new Error("Name required");
      const criteria = buildCriteria(e);
      const payload = { organization_id: orgId, name: e.name.trim(), description: e.description.trim() || null, icon: e.icon, color: e.color, criteria: criteria as unknown as never };
      if (e.id) {
        const { error } = await supabase.from("badges").update(payload).eq("id", e.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("badges").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["badges"] }); setOpen(false); setEditing(null); toast.success("Saved"); },
    onError: (err: Error) => toast.error(toUserMessage(err)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("badges").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["badges"] }); toast.success("Deleted"); },
    onError: (err: Error) => toast.error(toUserMessage(err)),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Award className="h-6 w-6" /> Badges</h1>
          <p className="text-sm text-muted-foreground mt-1">Achievements athletes can earn. Custom badges auto-award when criteria are met.</p>
        </div>
        <Button onClick={startNew}><Plus className="h-4 w-4 mr-1" /> New Badge</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Your Custom Badges</CardTitle></CardHeader>
        <CardContent>
          {mine.length === 0 ? <p className="text-sm text-muted-foreground">No custom badges yet.</p> : (
            <div className="grid gap-3 sm:grid-cols-2">{mine.map((b) => <BadgeRow key={b.id} b={b} onEdit={() => startEdit(b)} onDelete={() => del.mutate(b.id)} />)}</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Built-in Badges</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">{global.map((b) => <BadgeRow key={b.id} b={b} />)}</div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Badge" : "New Badge"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><Label>Description</Label><Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Icon</Label>
                  <Select value={editing.icon} onValueChange={(v) => setEditing({ ...editing, icon: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ICON_CHOICES.map((i) => { const I = iconFor(i); return <SelectItem key={i} value={i}><span className="flex items-center gap-2"><I className="h-4 w-4" />{i}</span></SelectItem>; })}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Color</Label>
                  <Select value={editing.color} onValueChange={(v) => setEditing({ ...editing, color: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{COLOR_CHOICES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Criteria</Label>
                <Select value={editing.criteriaType} onValueChange={(v) => setEditing({ ...editing, criteriaType: v as BadgeCriteria["type"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual (coach award)</SelectItem>
                    <SelectItem value="sessions_count">Sessions completed</SelectItem>
                    <SelectItem value="attendance_pct">Attendance %</SelectItem>
                    <SelectItem value="test_threshold">Test threshold</SelectItem>
                    <SelectItem value="lift_threshold">Lift threshold</SelectItem>
                    <SelectItem value="relative_strength_threshold">Relative strength (× bodyweight)</SelectItem>
                    <SelectItem value="pr_count">Personal records count</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(editing.criteriaType === "sessions_count" || editing.criteriaType === "attendance_pct") && (
                <div><Label>{editing.criteriaType === "attendance_pct" ? "Attendance % target" : "Sessions target"}</Label><Input type="number" value={editing.threshold} onChange={(e) => setEditing({ ...editing, threshold: e.target.value })} /></div>
              )}
              {editing.criteriaType === "test_threshold" && (
                <>
                  <div><Label>Test type key</Label><Input placeholder="e.g. vertical, fly_10" value={editing.test_type} onChange={(e) => setEditing({ ...editing, test_type: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Target value</Label><Input type="number" step="0.01" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} /></div>
                    <div className="flex items-end gap-2"><input id="lib" type="checkbox" checked={editing.lower_is_better} onChange={(e) => setEditing({ ...editing, lower_is_better: e.target.checked })} /><Label htmlFor="lib" className="pb-2">Lower is better</Label></div>
                  </div>
                </>
              )}
              {editing.criteriaType === "lift_threshold" && (
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Exercise</Label><Input value={editing.exercise} onChange={(e) => setEditing({ ...editing, exercise: e.target.value })} /></div>
                  <div><Label>Load (lb)</Label><Input type="number" value={editing.load} onChange={(e) => setEditing({ ...editing, load: e.target.value })} /></div>
                </div>
              )}
              {editing.criteriaType === "relative_strength_threshold" && (
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Exercise</Label><Input value={editing.exercise} onChange={(e) => setEditing({ ...editing, exercise: e.target.value })} /></div>
                  <div><Label>Ratio (× bodyweight)</Label><Input type="number" step="0.01" value={editing.ratio} onChange={(e) => setEditing({ ...editing, ratio: e.target.value })} /></div>
                </div>
              )}
              {editing.criteriaType === "pr_count" && (
                <div><Label>PR count target</Label><Input type="number" value={editing.count} onChange={(e) => setEditing({ ...editing, count: e.target.value })} /></div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => editing && save.mutate(editing)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BadgeRow({ b, onEdit, onDelete }: { b: BadgeType; onEdit?: () => void; onDelete?: () => void }) {
  const Icon = iconFor(b.icon);
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <span className={cn("grid h-10 w-10 place-items-center rounded-full ring-2 shrink-0", colorMap[b.color] ?? colorMap.primary)}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{b.name}</div>
        {b.description && <div className="text-xs text-muted-foreground mt-0.5">{b.description}</div>}
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">{b.criteria.type.replace(/_/g, " ")}</div>
      </div>
      {onEdit && <Button size="icon" variant="ghost" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>}
      {onDelete && <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
    </div>
  );
}
