import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { testsQO, liftsQO, attendanceQO, athleteDisplayName, type Athlete } from "@/lib/queries";
import { type DuplicateGroup } from "@/lib/validation";
import { planFirstLastMerges, type History, type MergePlan } from "@/lib/athlete-dedupe";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Merge } from "lucide-react";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";

/**
 * One-tap clean-up for the common case: the same kid imported or typed in more than once.
 * Matches by FIRST + LAST name, keeps the record with the most history, and shows the
 * whole plan before anything is deleted. Same-name kids with different student IDs or
 * graduation years are left alone for the hand review.
 */
export function BulkMergeDialog({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groups: DuplicateGroup<Athlete>[];
}) {
  const qc = useQueryClient();
  const { data: tests = [], isLoading: l1 } = useQuery({ ...testsQO, enabled: open });
  const { data: lifts = [], isLoading: l2 } = useQuery({ ...liftsQO, enabled: open });
  const { data: attendance = [], isLoading: l3 } = useQuery({ ...attendanceQO, enabled: open });

  const history = useMemo(() => {
    const m = new Map<string, History>();
    const bump = (id: string, k: keyof History) => {
      let row = m.get(id);
      if (!row) m.set(id, (row = { tests: 0, lifts: 0, attendance: 0 }));
      row[k] += 1;
    };
    for (const t of tests) bump(t.athlete_id, "tests");
    for (const l of lifts) bump(l.athlete_id, "lifts");
    for (const a of attendance) bump(a.athlete_id, "attendance");
    return m;
  }, [tests, lifts, attendance]);

  const plan = useMemo(() => {
    const byId = new Map<string, Athlete>();
    for (const g of groups) for (const m of g.members) byId.set(m.id, m);
    return planFirstLastMerges([...byId.values()], history);
  }, [groups, history]);

  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState(0);
  const chosen = plan.merges.filter((m) => !skipped.has(m.keep.id));
  const dropCount = chosen.reduce((n, m) => n + m.drop.length, 0);

  const run = useMutation({
    mutationFn: async (items: MergePlan<Athlete>[]) => {
      let done = 0;
      setProgress(0);
      try {
        for (const m of items) {
          for (const d of m.drop) {
            const { error } = await supabase.rpc("merge_athletes", {
              _keep: m.keep.id,
              _drop: d.id,
            });
            if (error) throw new Error(`${athleteDisplayName(m.keep)}: ${error.message}`);
          }
          done += 1;
          setProgress(done);
        }
      } catch (e) {
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), { merged: done });
      }
      return done;
    },
    onSuccess: (n) => {
      toast.success(`Merged ${n} athlete${n === 1 ? "" : "s"}`);
      setConfirm(false);
      onOpenChange(false);
    },
    onError: (e: Error & { merged?: number }) => {
      toast.error(`${e.merged ?? 0} merged, then stopped: ${toUserMessage(e)}`);
      setConfirm(false);
    },
    onSettled: () => {
      for (const key of [
        "athletes",
        "tests",
        "lifts",
        "attendance",
        "rep-maxes",
        "rep_maxes",
        "athlete-teams",
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const count = (id: string) => history.get(id) ?? { tests: 0, lifts: 0, attendance: 0 };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Merge athletes with the same first and last name</DialogTitle>
            <DialogDescription>
              For each name, the record with the most history is kept, and the others' tests, lifts,
              attendance and PRs move onto it. Untick any name you want to leave alone.
            </DialogDescription>
          </DialogHeader>

          {l1 || l2 || l3 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Counting history…</p>
          ) : !plan.merges.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing to merge automatically.
              {plan.needsReview.length ? " The rest need a hand review." : ""}
            </p>
          ) : (
            <div className="space-y-2">
              {plan.merges.map((m) => {
                const off = skipped.has(m.keep.id);
                const kc = count(m.keep.id);
                return (
                  <label
                    key={m.keep.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border p-2 text-sm ${off ? "opacity-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!off}
                      onChange={() =>
                        setSkipped((p) => {
                          const n = new Set(p);
                          if (n.has(m.keep.id)) n.delete(m.keep.id);
                          else n.add(m.keep.id);
                          return n;
                        })
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{athleteDisplayName(m.keep)}</div>
                      <div className="text-xs text-muted-foreground">
                        Keep: {kc.tests} tests · {kc.lifts} lifts · {kc.attendance} attendance
                        {m.keep.student_id ? ` · ID ${m.keep.student_id}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Merge {m.drop.length} duplicate{m.drop.length === 1 ? "" : "s"} into it:{" "}
                        {m.drop
                          .map((d) => {
                            const c = count(d.id);
                            const total = c.tests + c.lifts + c.attendance;
                            return `${total} record${total === 1 ? "" : "s"}`;
                          })
                          .join(", ")}
                      </div>
                    </div>
                  </label>
                );
              })}
              {plan.needsReview.length > 0 && (
                <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  {plan.needsReview.length} name{plan.needsReview.length === 1 ? " has" : "s have"}{" "}
                  records with different student IDs or graduation years. Those are left alone; use
                  Review to check them.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button disabled={!chosen.length || run.isPending} onClick={() => setConfirm(true)}>
              <Merge className="h-4 w-4" /> Merge {chosen.length} name
              {chosen.length === 1 ? "" : "s"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm} onOpenChange={(v) => !v && !run.isPending && setConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Merge {chosen.length} name{chosen.length === 1 ? "" : "s"} and remove {dropCount}{" "}
              duplicate record{dropCount === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All history moves onto the kept record first, then the duplicate records are deleted.
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={run.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                run.mutate(chosen);
              }}
              disabled={run.isPending}
            >
              {run.isPending ? `Merging… ${progress} of ${chosen.length}` : "Merge"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
