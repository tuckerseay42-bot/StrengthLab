import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, FolderKanban, Layers, Dumbbell, CalendarDays, Plus } from "lucide-react";
import {
  programsQO, programPhasesQO, programCyclesQO, programSessionsQO, workoutsQO,
  type Program,
} from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { cn } from "@/lib/utils";


/**
 * Expandable Program → Phase → Cycle → Session tree.
 * Used in: /programs list, sidebar, and create/assign pickers.
 */
export function ProgramHierarchyTree({
  programs,
  activeProgramId,
  onSelectProgram,
  onSelectSession,
  compact = false,
  className,
}: {
  programs: Program[];
  activeProgramId?: string | null;
  onSelectProgram?: (programId: string) => void;
  onSelectSession?: (session: { id: string; program_id: string; workout_id: string | null; name: string }) => void;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (programs.length === 0) {
    return <div className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}>No programs yet.</div>;
  }

  return (
    <ul className={cn("space-y-0.5", className)}>
      {programs.map((p) => {
        const expanded = open.has(p.id);
        const active = activeProgramId === p.id;
        return (
          <li key={p.id}>
            <div className={cn(
              "group flex items-center gap-1 rounded-md px-1 py-1 text-sm",
              active ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted",
            )}>
              <button onClick={() => toggle(p.id)} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label={expanded ? "Collapse" : "Expand"}>
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <button
                onClick={() => onSelectProgram?.(p.id)}
                className="min-w-0 flex-1 truncate text-left font-medium"
              >
                {p.name}
              </button>
            </div>
            {expanded && (
              <ProgramExpanded programId={p.id} organizationId={p.organization_id} onSelectSession={onSelectSession} compact={compact} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ProgramExpanded({ programId, organizationId, onSelectSession, compact }: {
  programId: string;
  organizationId: string;
  onSelectSession?: (s: { id: string; program_id: string; workout_id: string | null; name: string }) => void;
  compact: boolean;
}) {
  const qc = useQueryClient();
  const { data: phases = [], isPending: pP } = useQuery(programPhasesQO(programId));
  const { data: cycles = [], isPending: pC } = useQuery(programCyclesQO(programId));
  const { data: sessions = [], isPending: pS } = useQuery(programSessionsQO(programId));
  const [openPhases, setOpenPhases] = useState<Set<string>>(new Set());
  const [openCycles, setOpenCycles] = useState<Set<string>>(new Set());
  const tP = (id: string) => setOpenPhases((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const tC = (id: string) => setOpenCycles((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (pP || pC || pS) {
    return <div className="ml-6 py-1 text-xs text-muted-foreground">Loading…</div>;
  }

  return (
    <ul className="ml-4 border-l pl-2">
      {phases.length === 0 && (
        <li className="py-0.5 text-[10px] text-muted-foreground">No phases yet</li>
      )}
      {phases.map((phase) => {
        const pOpen = openPhases.has(phase.id);
        const phaseCycles = cycles.filter((c) => c.phase_id === phase.id);
        return (
          <li key={phase.id}>
            <div className="flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-muted">
              <button onClick={() => tP(phase.id)} className="rounded p-0.5 text-muted-foreground">
                {pOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              <Layers className="h-3 w-3 shrink-0" style={{ color: phase.color || undefined }} />
              <span className="truncate font-medium">{phase.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{phaseCycles.length}</span>
            </div>
            {pOpen && (
              <ul className="ml-3 border-l pl-2">
                {phaseCycles.length === 0 && (
                  <li className="py-0.5 text-[10px] text-muted-foreground">No cycles</li>
                )}
                {phaseCycles.map((c) => {
                  const cOpen = openCycles.has(c.id);
                  const cSessions = sessions.filter((s) => s.cycle_id === c.id);
                  return (
                    <li key={c.id}>
                      <div className="flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-muted">
                        <button onClick={() => tC(c.id)} className="rounded p-0.5 text-muted-foreground">
                          {cOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </button>
                        <CalendarDays className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{c.name}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">{c.weeks}w · {cSessions.length}</span>
                      </div>
                      {cOpen && (
                        <ul className="ml-3 border-l pl-2">
                          {cSessions.length === 0 ? (
                            <li className="py-0.5 text-[10px] text-muted-foreground">No sessions</li>
                          ) : cSessions.map((s) => (
                            <li key={s.id}>
                              {onSelectSession ? (
                                <button
                                  onClick={() => onSelectSession({ id: s.id, program_id: s.program_id, workout_id: s.workout_id, name: s.name })}
                                  className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-primary/10"
                                >
                                  <Dumbbell className="h-3 w-3 shrink-0 text-muted-foreground" />
                                  <span className="truncate">{s.name}</span>
                                  <span className="ml-auto text-[10px] text-muted-foreground">W{s.week}·D{s.day}</span>
                                </button>
                              ) : s.workout_id ? (
                                <Link
                                  to="/workouts/$id" params={{ id: s.workout_id }}
                                  className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-primary/10"
                                >
                                  <Dumbbell className="h-3 w-3 shrink-0 text-muted-foreground" />
                                  <span className="truncate">{s.name}</span>
                                  <span className="ml-auto text-[10px] text-muted-foreground">W{s.week}·D{s.day}</span>
                                </Link>
                              ) : (
                                <div className="flex items-center gap-1 px-1 py-0.5 text-xs text-muted-foreground">
                                  <Dumbbell className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{s.name}</span>
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
      <li>
        <InlinePhaseAdder programId={programId} organizationId={organizationId} position={phases.length} />
      </li>
    </ul>
  );
}

function InlinePhaseAdder({ programId, organizationId, position }: { programId: string; organizationId: string; position: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const add = useMutation({
    mutationFn: async () => {
      const n = name.trim();
      if (!n) throw new Error("Name required");
      const { error } = await supabase.from("program_phases" as never).insert({
        program_id: programId, organization_id: organizationId, name: n, position,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program_phases", programId] });
      setName(""); setOpen(false); toast.success("Phase added");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-0.5 flex w-full items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-3 w-3" /> Add phase
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); add.mutate(); }}
      className="mt-0.5 flex items-center gap-1 px-1"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setName(""); } }}
        placeholder="Phase name (e.g. Off-Season)"
        className="h-6 flex-1 rounded border bg-background px-1.5 text-[11px] outline-none focus:ring-1 focus:ring-primary"
      />
      <button type="submit" disabled={add.isPending} className="rounded bg-primary px-1.5 py-0.5 text-[11px] text-primary-foreground disabled:opacity-50">Add</button>
      <button type="button" onClick={() => { setOpen(false); setName(""); }} className="rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">✕</button>
    </form>
  );
}


/**
 * Small hook: fetch programs scoped to an org (or all).
 */
export function useProgramsForOrg(orgId: string | null | undefined) {
  const { data: all = [] } = useQuery(programsQO);
  return useMemo(() => (orgId ? all.filter((p) => p.organization_id === orgId) : all), [all, orgId]);
}

/**
 * Convenience alias.
 */
export function useWorkoutsForOrg(orgId: string | null | undefined) {
  const { data: all = [] } = useQuery(workoutsQO);
  return useMemo(() => (orgId ? all.filter((w) => w.organization_id === orgId) : all), [all, orgId]);
}
