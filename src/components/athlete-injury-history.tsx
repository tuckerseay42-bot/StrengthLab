// Injury history for one athlete — a running record instead of the flat
// "injured" status badge on the roster, which only ever holds one current
// state with no memory of what happened or whether it's resolved.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { athleteInjuriesQO, type InjurySeverity } from "@/lib/queries";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { MOVEMENT_PATTERNS, MOVEMENT_PATTERN_LABEL } from "@/lib/movement-patterns";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";

export const BODY_PARTS = [
  "Ankle",
  "Knee",
  "Hip",
  "Hamstring",
  "Quad",
  "Groin",
  "Calf",
  "Low back",
  "Upper back",
  "Shoulder",
  "Elbow",
  "Wrist/Hand",
  "Head/Neck",
  "Foot",
  "Other",
];

export const SEVERITY_LABEL: Record<InjurySeverity, string> = {
  minor: "Minor",
  moderate: "Moderate",
  severe: "Severe",
};

export const SEVERITY_CLASS: Record<InjurySeverity, string> = {
  minor: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  moderate: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  severe: "border-destructive/30 bg-destructive/10 text-destructive",
};

const emptyForm = {
  athlete_id: "",
  description: "",
  body_part: "",
  severity: "moderate" as InjurySeverity,
  started_on: new Date().toISOString().slice(0, 10),
  notes: "",
  restricted_patterns: [] as string[],
};

// Shared "Log an injury" dialog. Pass a fixed `athleteId` when it's already
// known (an athlete's own profile); pass `athletes` instead to show an
// athlete picker as the first field (the Injuries page, logging for
// whoever's currently flagged without leaving that page).
export function LogInjuryDialog({
  open,
  onOpenChange,
  athleteId,
  athletes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  athleteId?: string;
  athletes?: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm);

  const add = useMutation({
    mutationFn: async () => {
      const targetAthleteId = athleteId ?? form.athlete_id;
      if (!targetAthleteId) throw new Error("Pick an athlete");
      if (!form.description.trim()) throw new Error("Describe what happened");
      const organization_id = await getScopedOrgId();
      const { error } = await supabase.from("athlete_injuries" as never).insert({
        athlete_id: targetAthleteId,
        organization_id,
        description: form.description.trim(),
        body_part: form.body_part || null,
        severity: form.severity,
        started_on: form.started_on,
        notes: form.notes.trim() || null,
        restricted_patterns: form.restricted_patterns,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["athlete_injuries"] });
      toast.success("Injury logged");
      onOpenChange(false);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setForm(emptyForm);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log an injury</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {athletes && (
            <div>
              <Label>Athlete *</Label>
              <Select
                value={form.athlete_id || "__none"}
                onValueChange={(v) => setForm({ ...form, athlete_id: v === "__none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an athlete" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none" disabled>
                    Select an athlete
                  </SelectItem>
                  {athletes.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>What happened *</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="e.g. Rolled ankle during warmup"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Body part</Label>
              <Select
                value={form.body_part || "__none"}
                onValueChange={(v) => setForm({ ...form, body_part: v === "__none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {BODY_PARTS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Severity</Label>
              <Select
                value={form.severity}
                onValueChange={(v) => setForm({ ...form, severity: v as InjurySeverity })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minor">Minor</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="severe">Severe</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Date</Label>
            <Input
              type="date"
              value={form.started_on}
              onChange={(e) => setForm({ ...form, started_on: e.target.value })}
            />
          </div>
          <div>
            <Label>Rules out</Label>
            <p className="mb-1.5 text-xs text-muted-foreground">
              Training View flags any prescribed exercise tagged with one of these while this injury
              is open.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MOVEMENT_PATTERNS.map((p) => {
                const active = form.restricted_patterns.includes(p.value);
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        restricted_patterns: active
                          ? form.restricted_patterns.filter((v) => v !== p.value)
                          : [...form.restricted_patterns, p.value],
                      })
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
                      active
                        ? "border-destructive bg-destructive/10 text-destructive"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Treatment plan, restrictions, etc."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => add.mutate()} disabled={add.isPending}>
            Log injury
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AthleteInjuryHistory({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const { data: injuries = [] } = useQuery(athleteInjuriesQO);
  const mine = injuries
    .filter((i) => i.athlete_id === athleteId)
    .sort((a, b) => b.started_on.localeCompare(a.started_on));
  const active = mine.filter((i) => !i.resolved_on);
  const past = mine.filter((i) => i.resolved_on);

  const [open, setOpen] = useState(false);

  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("athlete_injuries" as never)
        .update({ resolved_on: new Date().toISOString().slice(0, 10) } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["athlete_injuries"] });
      toast.success("Marked resolved");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Injury history</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Log injury
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">No injuries on record.</p>
        ) : (
          <>
            {active.length > 0 && (
              <ul className="space-y-2">
                {active.map((inj) => (
                  <li
                    key={inj.id}
                    className="flex items-start justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={SEVERITY_CLASS[inj.severity]}>
                          {SEVERITY_LABEL[inj.severity]}
                        </Badge>
                        {inj.body_part && (
                          <span className="text-xs font-medium text-muted-foreground">
                            {inj.body_part}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-sm font-medium">{inj.description}</div>
                      <div className="text-xs text-muted-foreground">Since {inj.started_on}</div>
                      {inj.restricted_patterns.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {inj.restricted_patterns.map((p) => (
                            <Badge key={p} variant="outline" className="text-[10px]">
                              No {MOVEMENT_PATTERN_LABEL[p] ?? p}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {inj.notes && (
                        <div className="mt-1 text-xs text-muted-foreground">{inj.notes}</div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1"
                      onClick={() => resolve.mutate(inj.id)}
                      disabled={resolve.isPending}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Resolved
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {past.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Past
                </div>
                <ul className="divide-y">
                  {past.map((inj) => (
                    <li
                      key={inj.id}
                      className="flex items-center justify-between gap-2 py-1.5 text-sm"
                    >
                      <div className="min-w-0 truncate">
                        <span className="font-medium">{inj.description}</span>
                        {inj.body_part && (
                          <span className="text-muted-foreground"> · {inj.body_part}</span>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {inj.started_on} – {inj.resolved_on}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>

      <LogInjuryDialog open={open} onOpenChange={setOpen} athleteId={athleteId} />
    </Card>
  );
}
