import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { testsQO, liftsQO, attendanceQO, teamsQO, athleteDisplayName, type Athlete } from "@/lib/queries";
import { findAthleteDuplicateGroups, type DuplicateGroup } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Copy, Merge, X } from "lucide-react";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";

const DISMISS_KEY = "athlete-dup-dismissed";

function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}
function writeDismissed(s: Set<string>) {
  try { window.localStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(s))); } catch { /* ignore */ }
}
/** Stable key for a group of athletes, independent of ordering. */
function groupId(members: { id: string }[]) {
  return members.map((m) => m.id).sort().join("|");
}

const REASON_LABEL: Record<string, string> = {
  name: "Same name",
  student_id: "Same student ID",
  email: "Same email",
};

/** Returns the set of athlete ids that are part of a non-dismissed duplicate group. */
export function useDuplicateAthletes(athletes: Athlete[]) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  const groups = useMemo(() => {
    return findAthleteDuplicateGroups(athletes as unknown as (Athlete & { student_id?: string | null })[])
      .filter((g) => !dismissed.has(groupId(g.members)));
  }, [athletes, dismissed]);

  const duplicateIds = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) for (const m of g.members) s.add(m.id);
    return s;
  }, [groups]);

  const dismiss = (members: { id: string }[]) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(groupId(members));
      writeDismissed(next);
      return next;
    });
  };

  return { groups, duplicateIds, dismiss };
}

export function DuplicateAthletesBanner({
  groups, dismiss,
}: {
  groups: DuplicateGroup<Athlete>[];
  dismiss: (members: { id: string }[]) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!groups.length) return null;
  const count = groups.reduce((n, g) => n + g.members.length, 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
        <Copy className="h-4 w-4 shrink-0 text-amber-500" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">{count} possible duplicate athletes</span>{" "}
          <span className="text-muted-foreground">
            across {groups.length} {groups.length === 1 ? "group" : "groups"} — merge them to keep all history on one record.
          </span>
        </p>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Review</Button>
      </div>
      <DuplicateReviewDialog open={open} onOpenChange={setOpen} groups={groups} dismiss={dismiss} />
    </>
  );
}

function DuplicateReviewDialog({
  open, onOpenChange, groups, dismiss,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groups: DuplicateGroup<Athlete>[];
  dismiss: (members: { id: string }[]) => void;
}) {
  const qc = useQueryClient();
  const { data: tests = [] } = useQuery({ ...testsQO, enabled: open });
  const { data: lifts = [] } = useQuery({ ...liftsQO, enabled: open });
  const { data: attendance = [] } = useQuery({ ...attendanceQO, enabled: open });
  const { data: teams = [] } = useQuery(teamsQO);
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);

  const counts = useMemo(() => {
    const m = new Map<string, { tests: number; lifts: number; attendance: number }>();
    const bump = (id: string, k: "tests" | "lifts" | "attendance") => {
      let row = m.get(id);
      if (!row) m.set(id, (row = { tests: 0, lifts: 0, attendance: 0 }));
      row[k] += 1;
    };
    for (const t of tests) bump(t.athlete_id, "tests");
    for (const l of lifts) bump(l.athlete_id, "lifts");
    for (const a of attendance) bump(a.athlete_id, "attendance");
    return m;
  }, [tests, lifts, attendance]);

  const [keepBy, setKeepBy] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ keep: Athlete; drop: Athlete[] } | null>(null);

  const merge = useMutation({
    mutationFn: async ({ keep, drop }: { keep: Athlete; drop: Athlete[] }) => {
      for (const d of drop) {
        const { error } = await supabase.rpc("merge_athletes", { _keep: keep.id, _drop: d.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      for (const key of ["athletes", "tests", "lifts", "attendance", "rep-maxes", "athlete-teams"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      toast.success("Athletes merged");
      setConfirm(null);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Possible duplicate athletes</DialogTitle>
            <DialogDescription>
              Pick the record to keep — all tests, lifts, attendance and PRs from the others move onto it.
            </DialogDescription>
          </DialogHeader>

          {!groups.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No duplicates left to review.</p>
          ) : (
            <div className="space-y-4">
              {groups.map((g) => {
                const keepId = keepBy[g.key] ?? g.members[0].id;
                return (
                  <div key={g.key} className="rounded-lg border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{athleteDisplayName(g.members[0])}</span>
                      <Badge variant="outline">{REASON_LABEL[g.reason] ?? "Match"}</Badge>
                      <Badge variant="secondary">{g.members.length} records</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => dismiss(g.members)}
                      >
                        <X className="h-4 w-4" /> Not a duplicate
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {g.members.map((a) => {
                        const c = counts.get(a.id) ?? { tests: 0, lifts: 0, attendance: 0 };
                        const archived = !!(a as unknown as { archived_at?: string | null }).archived_at;
                        return (
                          <label
                            key={a.id}
                            className={`flex cursor-pointer items-start gap-3 rounded-md border p-2 text-sm ${keepId === a.id ? "border-primary bg-primary/5" : "border-transparent bg-muted/40"}`}
                          >
                            <input
                              type="radio"
                              name={`keep-${g.key}`}
                              className="mt-1"
                              checked={keepId === a.id}
                              onChange={() => setKeepBy((p) => ({ ...p, [g.key]: a.id }))}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="font-medium">{athleteDisplayName(a)}</span>
                                {archived && <Badge variant="secondary">Archived</Badge>}
                                {a.team_id && teamMap.get(a.team_id) && (
                                  <Badge variant="outline">{teamMap.get(a.team_id)}</Badge>
                                )}
                                {a.grade && <Badge variant="outline">Grade {a.grade}</Badge>}
                              </div>
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {(a as unknown as { student_id?: string | null }).student_id
                                  ? `ID ${(a as unknown as { student_id: string }).student_id} · ` : ""}
                                {a.athlete_email ? `${a.athlete_email} · ` : ""}
                                {c.tests} tests · {c.lifts} lifts · {c.attendance} attendance
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        disabled={merge.isPending}
                        onClick={() => {
                          const keep = g.members.find((m) => m.id === keepId)!;
                          setConfirm({ keep, drop: g.members.filter((m) => m.id !== keepId) });
                        }}
                      >
                        <Merge className="h-4 w-4" /> Merge into selected
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge {confirm?.drop.length} record{confirm?.drop.length === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              All history moves onto {confirm ? athleteDisplayName(confirm.keep) : ""}, blank details are filled in from the
              duplicate{confirm && confirm.drop.length > 1 ? "s" : ""}, and the duplicate record
              {confirm && confirm.drop.length > 1 ? "s are" : " is"} deleted. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (confirm) merge.mutate(confirm); }}
              disabled={merge.isPending}
            >
              {merge.isPending ? "Merging…" : "Merge"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
