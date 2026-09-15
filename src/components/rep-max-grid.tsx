import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getScopedOrgId } from "@/lib/scoped-insert";
import {
  athletesQO, repMaxesQO, exercisesQO, athleteDisplayName, type Athlete, type RepMax,
} from "@/lib/queries";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/components/page-header";
import { Filters, emptyFilters, filterAthletes, type FilterState } from "@/components/filters";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { useOrg1RMFormula } from "@/hooks/use-1rm-formula";
import { estimate1RM, ONE_RM_META } from "@/lib/one-rm";
import { toUserMessage } from "@/lib/db-errors";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ChevronDown, Dumbbell, Trash2 } from "lucide-react";

const REPS = [1, 2, 3, 4, 5] as const;
const today = () => new Date().toISOString().slice(0, 10);
const key = (athleteId: string, reps: number) => `${athleteId}:${reps}`;

type Draft = Record<string, string>;

export function RepMaxGrid() {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: repMaxes = [] } = useQuery(repMaxesQO);
  const { data: exercises = [] } = useQuery(exercisesQO);
  const [activeTeamId] = useActiveTeamId();
  const formula = useOrg1RMFormula();

  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [search, setSearch] = useState("");
  const [exercise, setExercise] = useState<string | null>(null);
  const [exSearch, setExSearch] = useState("");
  const [draft, setDraft] = useState<Draft>({});

  // Every lift we could hold a rep max for: library load exercises + anything
  // already recorded.
  const exerciseNames = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of exercises) {
      if (e.measurement_type && e.measurement_type !== "load") continue;
      seen.set(e.name.trim().toLowerCase(), e.name);
    }
    for (const r of repMaxes) seen.set(r.exercise_name.trim().toLowerCase(), r.exercise_name);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [exercises, repMaxes]);

  const activeExercise = exercise ?? exerciseNames[0] ?? null;
  const exerciseId = useMemo(
    () => exercises.find((e) => e.name.trim().toLowerCase() === (activeExercise ?? "").trim().toLowerCase())?.id ?? null,
    [exercises, activeExercise],
  );

  const roster = useMemo(() => {
    const base = filterAthletes(athletes, filters, activeTeamId);
    const q = search.trim().toLowerCase();
    const rows = q ? base.filter((a) => athleteDisplayName(a).toLowerCase().includes(q)) : base;
    return rows.sort((a, b) => athleteDisplayName(a).localeCompare(athleteDisplayName(b)));
  }, [athletes, filters, activeTeamId, search]);

  // athleteId:reps → best stored row for the selected lift
  const grid = useMemo(() => {
    const m = new Map<string, RepMax>();
    if (!activeExercise) return m;
    const nameKey = activeExercise.trim().toLowerCase();
    for (const r of repMaxes) {
      if (r.exercise_name.trim().toLowerCase() !== nameKey) continue;
      if (r.reps < 1 || r.reps > 5) continue;
      const k = key(r.athlete_id, r.reps);
      const cur = m.get(k);
      if (!cur || Number(r.load) > Number(cur.load)) m.set(k, r);
    }
    return m;
  }, [repMaxes, activeExercise]);

  const saveCell = useMutation({
    mutationFn: async (args: { athlete: Athlete; reps: number; value: string }) => {
      const { athlete, reps, value } = args;
      if (!activeExercise) throw new Error("Pick a lift first");
      const existing = grid.get(key(athlete.id, reps)) ?? null;
      const raw = value.trim();

      if (!raw) {
        if (!existing) return;
        const { error } = await supabase.from("rep_maxes").delete().eq("id", existing.id);
        if (error) throw error;
        return;
      }
      const load = Number(raw);
      if (!Number.isFinite(load) || load <= 0) throw new Error("Enter a weight in pounds");

      if (existing) {
        const { error } = await supabase
          .from("rep_maxes")
          .update({ load, tested_at: today() })
          .eq("id", existing.id);
        if (error) throw error;
        return;
      }
      const organization_id = await getScopedOrgId();
      const { error } = await supabase.from("rep_maxes").insert({
        organization_id,
        athlete_id: athlete.id,
        exercise_id: exerciseId,
        exercise_name: activeExercise,
        reps,
        load,
        tested_at: today(),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rep_maxes"] }),
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const commit = (athlete: Athlete, reps: number) => {
    const k = key(athlete.id, reps);
    if (!(k in draft)) return;
    const value = draft[k] ?? "";
    const current = grid.get(k);
    const currentStr = current ? String(Number(current.load)) : "";
    setDraft((d) => {
      const next = { ...d };
      delete next[k];
      return next;
    });
    if (value.trim() === currentStr) return;
    saveCell.mutate({ athlete, reps, value });
  };

  const clearRow = useMutation({
    mutationFn: async (athlete: Athlete) => {
      const ids = REPS.map((r) => grid.get(key(athlete.id, r))?.id).filter(Boolean) as string[];
      if (!ids.length) return;
      const { error } = await supabase.from("rep_maxes").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rep_maxes"] });
      toast.success("Rep maxes cleared");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const filteredExercises = useMemo(() => {
    const q = exSearch.trim().toLowerCase();
    return q ? exerciseNames.filter((n) => n.toLowerCase().includes(q)) : exerciseNames;
  }, [exerciseNames, exSearch]);

  if (!exerciseNames.length) {
    return (
      <EmptyState
        icon={Dumbbell}
        title="No lifts yet"
        description="Add exercises to the library, or log a lift, and their 1RM–5RM will be editable here."
      />
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-8 gap-1.5 border-border/60 bg-transparent px-3 text-xs font-medium">
              <Dumbbell className="h-3.5 w-3.5 opacity-70" />
              <span className="max-w-[12rem] truncate">{activeExercise}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-1">
            <Input
              value={exSearch}
              onChange={(e) => setExSearch(e.target.value)}
              placeholder="Search lifts…"
              className="mb-1 h-8 text-xs"
            />
            <div className="max-h-80 overflow-y-auto">
              {filteredExercises.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => { setExercise(n); setDraft({}); }}
                  className={cn(
                    "flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                    n === activeExercise && "bg-muted font-medium",
                  )}
                >
                  <span className="truncate">{n}</span>
                </button>
              ))}
              {!filteredExercises.length && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">No lift matches.</p>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <Filters value={filters} onChange={setFilters} athletes={athletes} showDates={false} />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search athlete…"
          className="h-8 w-40 text-xs"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{activeExercise} — 1RM to 5RM</CardTitle>
          <p className="text-xs text-muted-foreground">
            Type a weight in any box to set or correct that rep max; clear a box to remove it. Saves when you leave the box.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {!roster.length ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No athletes match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Athlete
                    </th>
                    {REPS.map((r) => (
                      <th key={r} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {r}RM
                        <div className="text-[9px] font-normal normal-case tracking-normal opacity-70">lb</div>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Best e1RM
                    </th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {roster.map((a) => {
                    const cells = REPS.map((r) => grid.get(key(a.id, r)) ?? null);
                    const best = cells.reduce<number | null>((acc, c, i) => {
                      if (!c) return acc;
                      const e = estimate1RM(Number(c.load), REPS[i], formula);
                      return e != null && (acc == null || e > acc) ? e : acc;
                    }, null);
                    return (
                      <tr key={a.id} className="border-t border-border/50 hover:bg-muted/20">
                        <td className="sticky left-0 z-10 bg-background px-3 py-1.5">
                          <div className="font-medium">{athleteDisplayName(a)}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {[a.grade ? `G${a.grade}` : null, a.sport].filter(Boolean).join(" · ")}
                          </div>
                        </td>
                        {REPS.map((r, i) => {
                          const k = key(a.id, r);
                          const stored = cells[i];
                          const value = draft[k] ?? (stored ? String(Number(stored.load)) : "");
                          return (
                            <td key={r} className="px-1.5 py-1.5 text-center">
                              <Input
                                inputMode="decimal"
                                value={value}
                                placeholder="—"
                                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                                onBlur={() => commit(a, r)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                }}
                                className="h-9 w-20 text-center font-mono text-sm tabular-nums"
                              />
                              {stored && (
                                <div className="mt-0.5 text-[9px] text-muted-foreground">{stored.tested_at}</div>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-1.5 text-right">
                          {best == null ? (
                            <Badge variant="outline" className="border-destructive/40 text-[10px] text-destructive">
                              no data
                            </Badge>
                          ) : (
                            <span className="stat-number tabular-nums text-base">
                              {Math.round(best / 5) * 5}
                              <span className="ml-1 text-[10px] text-muted-foreground">lb</span>
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Clear this athlete's rep maxes for this lift"
                            onClick={() => clearRow.mutate(a)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Best e1RM uses {ONE_RM_META[formula].label} — {ONE_RM_META[formula].expression}. These rep maxes are exactly what the
        program builder and Training View use to price %-of-1RM sets, so an edit here changes prescribed weights immediately.
      </p>
    </div>
  );
}
