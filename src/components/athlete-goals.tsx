// Per-athlete goals ("Squat 400 by spring") with measurable progress where
// the goal is tied to a lift's e1RM or a test type — not just a note with
// no way to tell how close someone actually is.
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  athleteGoalsQO,
  repMaxesQO,
  testsQO,
  exercisesQO,
  type GoalMetricKind,
} from "@/lib/queries";
import { bestE1rm } from "@/lib/prescription";
import { useOrg1RMFormula } from "@/hooks/use-1rm-formula";
import { TEST_TYPES, testTypeMeta } from "@/lib/domain";
import { getScopedOrgId } from "@/lib/scoped-insert";
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
import { Plus, CheckCircle2, Target } from "lucide-react";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";

const emptyForm = {
  title: "",
  metric_kind: "custom" as GoalMetricKind,
  exercise_id: "",
  test_type: "",
  target_value: "",
  target_date: "",
  notes: "",
};

export function AthleteGoals({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const { data: goals = [] } = useQuery(athleteGoalsQO);
  const { data: repMaxes = [] } = useQuery(repMaxesQO);
  const { data: tests = [] } = useQuery(testsQO);
  const { data: exercises = [] } = useQuery(exercisesQO);
  const formula = useOrg1RMFormula();

  const mine = useMemo(
    () =>
      goals
        .filter((g) => g.athlete_id === athleteId)
        .sort((a, b) => {
          const aDone = a.achieved_on ? 1 : 0;
          const bDone = b.achieved_on ? 1 : 0;
          if (aDone !== bDone) return aDone - bDone;
          return (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999");
        }),
    [goals, athleteId],
  );

  const progressFor = (goal: (typeof mine)[number]) => {
    if (goal.metric_kind === "exercise_1rm") {
      const best = bestE1rm(repMaxes, athleteId, goal.exercise_id, goal.exercise_name, formula);
      return best ? best.e1rm : null;
    }
    if (goal.metric_kind === "test") {
      const rows = tests.filter(
        (t) => t.athlete_id === athleteId && t.test_type === goal.test_type,
      );
      if (!rows.length) return null;
      const meta = testTypeMeta(goal.test_type ?? "");
      return rows.reduce(
        (best, t) => (meta.lowerIsBetter ? Math.min(best, t.value) : Math.max(best, t.value)),
        rows[0].value,
      );
    }
    return null;
  };

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const add = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error("Give the goal a title");
      const organization_id = await getScopedOrgId();
      const exercise = exercises.find((e) => e.id === form.exercise_id);
      const { error } = await supabase.from("athlete_goals" as never).insert({
        athlete_id: athleteId,
        organization_id,
        title: form.title.trim(),
        metric_kind: form.metric_kind,
        exercise_id: form.metric_kind === "exercise_1rm" ? form.exercise_id || null : null,
        exercise_name: form.metric_kind === "exercise_1rm" ? (exercise?.name ?? null) : null,
        test_type: form.metric_kind === "test" ? form.test_type || null : null,
        target_value: form.target_value ? Number(form.target_value) : null,
        target_date: form.target_date || null,
        notes: form.notes.trim() || null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["athlete_goals"] });
      toast.success("Goal added");
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const markAchieved = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("athlete_goals" as never)
        .update({ achieved_on: new Date().toISOString().slice(0, 10) } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["athlete_goals"] });
      toast.success("Goal marked achieved");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Goals</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Add goal
        </Button>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">No goals set yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {mine.map((goal) => {
              const current = progressFor(goal);
              const pct =
                current != null && goal.target_value != null && goal.target_value !== 0
                  ? Math.min(100, Math.round((current / goal.target_value) * 100))
                  : null;
              const reached =
                !goal.achieved_on &&
                current != null &&
                goal.target_value != null &&
                current >= goal.target_value;
              return (
                <li
                  key={goal.id}
                  className={cn(
                    "rounded-md border p-2.5",
                    goal.achieved_on
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-border/60",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{goal.title}</span>
                        {goal.achieved_on && (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          >
                            Achieved
                          </Badge>
                        )}
                        {reached && (
                          <Badge
                            variant="outline"
                            className="border-primary/30 bg-primary/10 text-primary"
                          >
                            Target reached
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {goal.target_date && `By ${goal.target_date}`}
                        {current != null && goal.target_value != null && (
                          <>
                            {goal.target_date && " · "}
                            {Math.round(current * 10) / 10} / {goal.target_value}
                          </>
                        )}
                      </div>
                      {goal.notes && (
                        <div className="mt-1 text-xs text-muted-foreground">{goal.notes}</div>
                      )}
                    </div>
                    {!goal.achieved_on && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 gap-1"
                        onClick={() => markAchieved.mutate(goal.id)}
                        disabled={markAchieved.isPending}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Achieved
                      </Button>
                    )}
                  </div>
                  {pct != null && !goal.achieved_on && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <span className="flex items-center gap-1.5">
                <Target className="h-4 w-4" /> Add a goal
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Squat 400 by spring"
              />
            </div>
            <div>
              <Label>Track against</Label>
              <Select
                value={form.metric_kind}
                onValueChange={(v) => setForm({ ...form, metric_kind: v as GoalMetricKind })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom (no auto progress)</SelectItem>
                  <SelectItem value="exercise_1rm">A lift's estimated 1RM</SelectItem>
                  <SelectItem value="test">A test result</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.metric_kind === "exercise_1rm" && (
              <div>
                <Label>Exercise</Label>
                <Select
                  value={form.exercise_id || "__none"}
                  onValueChange={(v) => setForm({ ...form, exercise_id: v === "__none" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick an exercise" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {exercises.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.metric_kind === "test" && (
              <div>
                <Label>Test type</Label>
                <Select
                  value={form.test_type || "__none"}
                  onValueChange={(v) => setForm({ ...form, test_type: v === "__none" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a test" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {TEST_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Target value</Label>
                <Input
                  inputMode="decimal"
                  value={form.target_value}
                  onChange={(e) => setForm({ ...form, target_value: e.target.value })}
                  placeholder="400"
                />
              </div>
              <div>
                <Label>Target date</Label>
                <Input
                  type="date"
                  value={form.target_date}
                  onChange={(e) => setForm({ ...form, target_date: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => add.mutate()} disabled={add.isPending}>
              Add goal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
