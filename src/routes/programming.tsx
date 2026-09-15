import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveOrgId } from "@/hooks/use-active-org";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  programsQO, programPhasesQO, programCyclesQO, programSessionsQO, programVersionsQO,
  workoutsQO, teamsQO,
  type Program, type ProgramPhase, type ProgramCycle, type ProgramSession, type Workout, type ProgramVersion,
} from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { CenteredSpinner } from "@/components/loading";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import {
  ChevronRight, ChevronDown, Plus, MoreHorizontal, Copy, Trash2, Pencil,
  FolderKanban, Layers, CalendarDays, Dumbbell, FolderPlus, FilePlus2, Move,
  PanelLeft, GripVertical, ArrowRightLeft, Zap, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { WorkoutEditor } from "@/components/workout-editor";
import { duplicateWorkout } from "@/lib/workout-duplicate";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ---------------- URL search-param persistence ----------------
const searchSchema = z.object({
  program: z.string().optional(),
  phase: z.string().optional(),
  cycle: z.string().optional(),
  session: z.string().optional(),
  workout: z.string().optional(), // legacy fallback: /workouts/$id → /programming?workout=id
});
type SearchParams = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/programming")({
  validateSearch: (raw) => searchSchema.parse(raw),
  head: () => ({
    meta: [
      { title: "Programming Workspace — Strength Lab" },
      { name: "description", content: "One-screen program builder: hierarchy tree on the left, contextual editor on the right." },
    ],
  }),
  component: ProgrammingWorkspace,
});

type SelKind = "none" | "program" | "phase" | "cycle" | "session" | "workout";
type Sel =
  | { kind: "none" }
  | { kind: "program"; id: string }
  | { kind: "phase"; id: string; programId: string }
  | { kind: "cycle"; id: string; programId: string }
  | { kind: "session"; id: string; programId: string }
  | { kind: "workout"; id: string };

function selFromSearch(s: SearchParams): Sel {
  if (s.workout) return { kind: "workout", id: s.workout };
  if (s.session && s.program) return { kind: "session", id: s.session, programId: s.program };
  if (s.cycle && s.program)   return { kind: "cycle",   id: s.cycle,   programId: s.program };
  if (s.phase && s.program)   return { kind: "phase",   id: s.phase,   programId: s.program };
  if (s.program)              return { kind: "program", id: s.program };
  return { kind: "none" };
}
function selToSearch(sel: Sel): SearchParams {
  if (sel.kind === "workout") return { workout: sel.id };
  if (sel.kind === "session") return { program: sel.programId, session: sel.id };
  if (sel.kind === "cycle")   return { program: sel.programId, cycle: sel.id };
  if (sel.kind === "phase")   return { program: sel.programId, phase: sel.id };
  if (sel.kind === "program") return { program: sel.id };
  return {};
}

function ProgrammingWorkspace() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [activeOrgId] = useActiveOrgId();
  const isMobile = useIsMobile();

  const { data: programsAll = [] } = useQuery(programsQO);
  const { data: teamsAll = [] } = useQuery(teamsQO);
  const programs = useMemo(
    () => (activeOrgId ? programsAll.filter((p) => p.organization_id === activeOrgId) : programsAll),
    [programsAll, activeOrgId],
  );
  const teams = useMemo(
    () => (activeOrgId ? teamsAll.filter((t) => t.organization_id === activeOrgId) : teamsAll),
    [teamsAll, activeOrgId],
  );

  const sel = selFromSearch(search);
  const setSel = (next: Sel) => {
    navigate({ to: "/programming", search: selToSearch(next), replace: false });
  };

  const [newProgOpen, setNewProgOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false); // mobile drawer

  // Resolve workout → session (auto-redirect the URL) so the tree highlights correctly
  const { data: allSessionsForResolve = [] } = useQuery({
    queryKey: ["program_sessions_all_for_resolve", sel.kind === "workout" ? sel.id : null],
    queryFn: async () => {
      if (sel.kind !== "workout") return [] as ProgramSession[];
      const { data, error } = await supabase.from("program_sessions" as never)
        .select("*").eq("workout_id", sel.id).limit(1);
      if (error) throw error;
      return (data ?? []) as unknown as ProgramSession[];
    },
    enabled: sel.kind === "workout",
  });
  useEffect(() => {
    if (sel.kind === "workout" && allSessionsForResolve.length > 0) {
      const s = allSessionsForResolve[0];
      setSel({ kind: "session", id: s.id, programId: s.program_id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.kind === "workout" ? sel.id : null, allSessionsForResolve.length]);

  const treeBody = (
    <TreePanel
      programs={programs}
      sel={sel}
      onSelect={(s) => { setSel(s); if (isMobile) setTreeOpen(false); }}
      onNewProgram={() => setNewProgOpen(true)}
    />
  );

  return (
      <div className="flex h-[calc(100dvh-4rem)] flex-col">
        {/* Compact breadcrumb / mobile trigger */}
        <div className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
          <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline" className="h-8"><PanelLeft className="h-4 w-4" /> Programs</Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[86vw] max-w-[340px] p-0">
              <SheetHeader className="border-b px-3 py-2 text-left">
                <SheetTitle className="text-sm">Programs</SheetTitle>
              </SheetHeader>
              <div className="border-b p-2">
                <Button size="sm" variant="outline" className="w-full" onClick={() => { setTreeOpen(false); setNewProgOpen(true); }}>
                  <Plus className="mr-1 h-4 w-4" /> New program
                </Button>
              </div>
              <div className="h-[calc(100dvh-6.5rem)] overflow-auto p-2">{treeBody}</div>
            </SheetContent>
          </Sheet>
          <Breadcrumb sel={sel} programs={programs} onSelect={setSel} compact />
          <div className="ml-auto">
            <ContextNewButton
              sel={sel}
              programs={programs}
              onNewProgram={() => setNewProgOpen(true)}
              onSelect={setSel}
            />
          </div>
        </div>


      <div className="min-h-0 flex-1">
        {isMobile ? (
          <div className="h-full overflow-auto">
            <EditorPane sel={sel} onSelect={setSel} programs={programs} onNewProgram={() => setNewProgOpen(true)} />
          </div>
        ) : (
          <div className="flex h-full">
            <aside className="flex w-[300px] shrink-0 flex-col border-r">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Programs</div>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setNewProgOpen(true)} title="New program">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">{treeBody}</div>
            </aside>
            <section className="flex min-w-0 flex-1 flex-col">
              <Breadcrumb sel={sel} programs={programs} onSelect={setSel} />
              <div className="min-h-0 flex-1 overflow-auto">
                <EditorPane sel={sel} onSelect={setSel} programs={programs} onNewProgram={() => setNewProgOpen(true)} />
              </div>
            </section>
          </div>
        )}
      </div>


      <NewProgramDialog
        open={newProgOpen}
        onOpenChange={setNewProgOpen}
        teams={teams}
        onCreated={(id) => setSel({ kind: "program", id })}
      />
    </div>
  );
}

// ================= BREADCRUMB =================
function Breadcrumb({ sel, programs, onSelect, compact }: {
  sel: Sel; programs: Program[]; onSelect: (s: Sel) => void; compact?: boolean;
}) {
  const programId = sel.kind === "program" ? sel.id
    : sel.kind === "phase" || sel.kind === "cycle" || sel.kind === "session" ? sel.programId
    : null;
  const { data: phases = [] } = useQuery({ ...programPhasesQO(programId || ""), enabled: !!programId });
  const { data: cycles = [] } = useQuery({ ...programCyclesQO(programId || ""), enabled: !!programId });
  const { data: sessions = [] } = useQuery({ ...programSessionsQO(programId || ""), enabled: !!programId });

  if (sel.kind === "none" || sel.kind === "workout") {
    return <div className={cn("flex items-center border-b px-4 py-1.5 text-xs text-muted-foreground", compact && "border-none px-0")}>Programming workspace</div>;
  }
  const program = programs.find((p) => p.id === programId);
  const phaseId = sel.kind === "phase" ? sel.id
    : sel.kind === "cycle" ? cycles.find((c) => c.id === sel.id)?.phase_id
    : sel.kind === "session" ? sessions.find((s) => s.id === sel.id)?.phase_id
    : null;
  const cycleId = sel.kind === "cycle" ? sel.id
    : sel.kind === "session" ? sessions.find((s) => s.id === sel.id)?.cycle_id
    : null;
  const phase = phaseId ? phases.find((p) => p.id === phaseId) : null;
  const cycle = cycleId ? cycles.find((c) => c.id === cycleId) : null;
  const session = sel.kind === "session" ? sessions.find((s) => s.id === sel.id) : null;

  const Crumb = ({ label, onClick, active }: { label: string; onClick?: () => void; active?: boolean }) => (
    <button
      onClick={onClick}
      className={cn(
        "truncate rounded px-1.5 py-0.5 text-xs",
        active ? "font-semibold text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >{label}</button>
  );
  const Sep = () => <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />;

  return (
    <div className={cn("flex items-center gap-0.5 border-b px-3 py-1.5", compact && "border-none px-0 py-0")}>
      {program && <Crumb label={`Program: ${program.name}`} onClick={() => onSelect({ kind: "program", id: program.id })} active={sel.kind === "program"} />}
      {phase && <><Sep /><Crumb label={phase.name} onClick={() => onSelect({ kind: "phase", id: phase.id, programId: program!.id })} active={sel.kind === "phase"} /></>}
      {cycle && <><Sep /><Crumb label={cycle.name} onClick={() => onSelect({ kind: "cycle", id: cycle.id, programId: program!.id })} active={sel.kind === "cycle"} /></>}
      {session && <><Sep /><Crumb label={session.name} active /></>}
    </div>
  );
}

// ================= Context-aware mobile "New" button =================
function ContextNewButton({
  sel,
  programs,
  onNewProgram,
  onSelect,
}: {
  sel: Sel;
  programs: Program[];
  onNewProgram: () => void;
  onSelect: (s: Sel) => void;
}) {
  const qc = useQueryClient();
  const programId =
    sel.kind === "program"
      ? sel.id
      : sel.kind === "phase" || sel.kind === "cycle" || sel.kind === "session"
        ? sel.programId
        : null;
  const program = programId ? programs.find((p) => p.id === programId) : undefined;

  const { data: phases = [] } = useQuery({ ...programPhasesQO(programId || ""), enabled: !!programId });
  const { data: cycles = [] } = useQuery({ ...programCyclesQO(programId || ""), enabled: !!programId });
  const { data: sessions = [] } = useQuery({ ...programSessionsQO(programId || ""), enabled: !!programId });

  const phaseId = sel.kind === "phase" ? sel.id : null;
  const cycleId = sel.kind === "cycle" ? sel.id : null;
  const phase = phaseId ? phases.find((p) => p.id === phaseId) : null;
  const cycle = cycleId ? cycles.find((c) => c.id === cycleId) : null;

  const addCycle = useMutation({
    mutationFn: async () => {
      if (!phase || !program) throw new Error("Select a phase first");
      const phaseCycles = cycles.filter((c) => c.phase_id === phase.id);
      const { data, error } = await supabase.from("program_cycles" as never).insert({
        phase_id: phase.id, program_id: program.id, organization_id: program.organization_id,
        name: `Week ${phaseCycles.length + 1}`, weeks: 1, position: phaseCycles.length,
      } as never).select("id").single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["program_cycles", programId] });
      toast.success("Cycle added");
      onSelect({ kind: "cycle", id, programId: programId! });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const addSession = useMutation({
    mutationFn: async () => {
      if (!cycle || !program) throw new Error("Select a cycle first");
      const phaseId = cycle.phase_id || phases[0]?.id;
      if (!phaseId) throw new Error("Add a phase first");
      const cSessions = sessions.filter((s) => s.cycle_id === cycle.id);
      const n = cSessions.length + 1;
      const { data: w, error: we } = await supabase.from("workouts").insert({
        name: `Day ${n}`,
        team_id: program.team_id, organization_id: program.organization_id,
      } as never).select("id").single();
      if (we) throw we;
      const { data: ns, error } = await supabase.from("program_sessions" as never).insert({
        cycle_id: cycle.id, phase_id: phaseId, program_id: program.id,
        organization_id: program.organization_id,
        workout_id: (w as { id: string }).id,
        name: `Day ${n}`,
        week: 1, day: n, position: cSessions.length,
      } as never).select("id").single();
      if (error) throw error;
      return (ns as { id: string }).id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["program_sessions", programId] });
      qc.invalidateQueries({ queryKey: ["workouts"] });
      toast.success("Workout added");
      onSelect({ kind: "session", id, programId: programId! });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  if (sel.kind === "none" || sel.kind === "program") {
    return (
      <Button size="sm" className="h-8" onClick={onNewProgram}>
        <Plus className="h-4 w-4" /> New program
      </Button>
    );
  }

  if (sel.kind === "phase") {
    return (
      <Button size="sm" className="h-8" onClick={() => addCycle.mutate()} disabled={addCycle.isPending}>
        <Plus className="h-4 w-4" /> Add cycle
      </Button>
    );
  }

  if (sel.kind === "cycle") {
    return (
      <Button size="sm" className="h-8" onClick={() => addSession.mutate()} disabled={addSession.isPending}>
        <Plus className="h-4 w-4" /> Add workout
      </Button>
    );
  }

  // In a session: no mobile header action for now to avoid confusion.
  return null;
}

// ================= LEFT TREE =================


function TreePanel({ programs, sel, onSelect, onNewProgram }: {
  programs: Program[]; sel: Sel; onSelect: (s: Sel) => void; onNewProgram: () => void;
}) {
  if (programs.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-muted-foreground">
        No programs yet.
        <Button size="sm" variant="outline" className="mt-3 w-full" onClick={onNewProgram}>
          <Plus className="mr-1 h-3.5 w-3.5" /> New program
        </Button>
      </div>
    );
  }
  return (
    <ul className="space-y-0.5">
      {programs.map((p) => (
        <ProgramNode key={p.id} program={p} sel={sel} onSelect={onSelect} />
      ))}
    </ul>
  );
}

function ProgramNode({ program, sel, onSelect }: {
  program: Program; sel: Sel; onSelect: (s: Sel) => void;
}) {
  const qc = useQueryClient();
  const contains =
    (sel.kind === "program" && sel.id === program.id) ||
    ((sel.kind === "phase" || sel.kind === "cycle" || sel.kind === "session") && sel.programId === program.id);
  const [open, setOpen] = useState(contains);
  useEffect(() => { if (contains) setOpen(true); }, [contains]);

  const { data: phases = [] } = useQuery(programPhasesQO(program.id));
  const { data: cycles = [] } = useQuery(programCyclesQO(program.id));
  const { data: sessions = [] } = useQuery(programSessionsQO(program.id));
  const active = sel.kind === "program" && sel.id === program.id;

  const addPhase = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("program_phases" as never).insert({
        program_id: program.id, organization_id: program.organization_id,
        name: `Phase ${phases.length + 1}`, position: phases.length,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["program_phases", program.id] }); toast.success("Phase added"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const rename = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("programs" as never).update({ name } as never).eq("id", program.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["programs"] }),
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("programs" as never).delete().eq("id", program.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["programs"] });
      toast.success("Program deleted");
      onSelect({ kind: "none" });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  // DnD: reorder phases within this program
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const phaseIds = phases.map((p) => p.id);
  const reorderPhases = useMutation({
    mutationFn: async (ordered: ProgramPhase[]) => {
      await Promise.all(ordered.map((p, i) =>
        supabase.from("program_phases" as never).update({ position: i } as never).eq("id", p.id),
      ));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["program_phases", program.id] }),
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });
  const handlePhaseDragEnd = (evt: DragEndEvent) => {
    const { active: a, over } = evt;
    if (!over || a.id === over.id) return;
    const oldIdx = phaseIds.indexOf(String(a.id));
    const newIdx = phaseIds.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(phases, oldIdx, newIdx);
    qc.setQueryData(["program_phases", program.id], () => next.map((p, i) => ({ ...p, position: i })));
    reorderPhases.mutate(next);
  };

  return (
    <li>
      <Row
        active={active}
        onClick={() => onSelect({ kind: "program", id: program.id })}
        chevron={<ChevronBtn open={open} onToggle={() => setOpen(!open)} />}
        icon={<FolderKanban className="h-3.5 w-3.5 text-primary" />}
        label={program.name}
        badge={`${phases.length}`}
        menu={
          <>
            <DropdownMenuItem onClick={() => addPhase.mutate()}><FolderPlus className="mr-2 h-3.5 w-3.5" />Add phase</DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              const n = prompt("New program name", program.name);
              if (n && n.trim()) rename.mutate(n.trim());
            }}><Pencil className="mr-2 h-3.5 w-3.5" />Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { if (confirm(`Delete "${program.name}" and everything inside?`)) del.mutate(); }} className="text-destructive">
              <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
            </DropdownMenuItem>
          </>
        }
      />
      {open && (
        <ul className="ml-3 border-l pl-1">
          {phases.length === 0 && (
            <li className="px-2 py-1 text-[11px] text-muted-foreground">
              <button onClick={() => addPhase.mutate()} className="inline-flex items-center gap-1 hover:text-foreground">
                <Plus className="h-3 w-3" /> Add phase
              </button>
            </li>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handlePhaseDragEnd}>
            <SortableContext items={phaseIds} strategy={verticalListSortingStrategy}>
              {phases.map((ph) => (
                <SortableWrap key={ph.id} id={ph.id}>
                  {(handleProps) => (
                    <PhaseNode
                      program={program}
                      phase={ph}
                      cycles={cycles.filter((c) => c.phase_id === ph.id)}
                      sessions={sessions}
                      sel={sel}
                      onSelect={onSelect}
                      dragHandleProps={handleProps}
                    />
                  )}
                </SortableWrap>
              ))}
            </SortableContext>
          </DndContext>
        </ul>
      )}
    </li>
  );
}

function PhaseNode({ program, phase, cycles, sessions, sel, onSelect, dragHandleProps }: {
  program: Program; phase: ProgramPhase; cycles: ProgramCycle[]; sessions: ProgramSession[];
  sel: Sel; onSelect: (s: Sel) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  const qc = useQueryClient();
  const contains =
    (sel.kind === "phase" && sel.id === phase.id) ||
    ((sel.kind === "cycle" || sel.kind === "session") &&
      cycles.some((c) => c.id === (sel.kind === "cycle" ? sel.id : sessions.find((s) => s.id === (sel as { id: string }).id)?.cycle_id)));
  const [open, setOpen] = useState(contains);
  useEffect(() => { if (contains) setOpen(true); }, [contains]);
  const active = sel.kind === "phase" && sel.id === phase.id;

  const addCycle = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("program_cycles" as never).insert({
        phase_id: phase.id, program_id: program.id, organization_id: program.organization_id,
        name: `Week ${cycles.length + 1}`, weeks: 1, position: cycles.length,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["program_cycles", program.id] }),
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });
  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("program_phases" as never).delete().eq("id", phase.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program_phases", program.id] });
      qc.invalidateQueries({ queryKey: ["program_cycles", program.id] });
      qc.invalidateQueries({ queryKey: ["program_sessions", program.id] });
      onSelect({ kind: "program", id: program.id });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  // DnD: reorder cycles within this phase
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const cycleIds = cycles.map((c) => c.id);
  const reorder = useMutation({
    mutationFn: async (ordered: ProgramCycle[]) => {
      await Promise.all(ordered.map((c, i) =>
        supabase.from("program_cycles" as never).update({ position: i } as never).eq("id", c.id),
      ));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["program_cycles", program.id] }),
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });
  const handleDragEnd = (evt: DragEndEvent) => {
    const { active: a, over } = evt;
    if (!over || a.id === over.id) return;
    const oldIdx = cycleIds.indexOf(String(a.id));
    const newIdx = cycleIds.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(cycles, oldIdx, newIdx);
    qc.setQueryData(["program_cycles", program.id], (prev: ProgramCycle[] | undefined) => {
      if (!prev) return prev;
      const others = prev.filter((c) => c.phase_id !== phase.id);
      return [...others, ...next.map((c, i) => ({ ...c, position: i }))].sort((x, y) => x.position - y.position);
    });
    reorder.mutate(next);
  };

  return (
    <li>
      <Row
        active={active}
        onClick={() => onSelect({ kind: "phase", id: phase.id, programId: program.id })}
        chevron={<ChevronBtn open={open} onToggle={() => setOpen(!open)} />}
        icon={<Layers className="h-3.5 w-3.5" style={{ color: phase.color || undefined }} />}
        label={phase.name}
        badge={`${cycles.length}`}
        dragHandleProps={dragHandleProps}
        menu={
          <>
            <DropdownMenuItem onClick={() => addCycle.mutate()}><FolderPlus className="mr-2 h-3.5 w-3.5" />Add cycle / week</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { if (confirm(`Delete phase "${phase.name}"?`)) del.mutate(); }} className="text-destructive">
              <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
            </DropdownMenuItem>
          </>
        }
      />
      {open && (
        <ul className="ml-3 border-l pl-1">
          {cycles.length === 0 && (
            <li className="px-2 py-1 text-[11px] text-muted-foreground">
              <button onClick={() => addCycle.mutate()} className="inline-flex items-center gap-1 hover:text-foreground">
                <Plus className="h-3 w-3" /> Add cycle
              </button>
            </li>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={cycleIds} strategy={verticalListSortingStrategy}>
              {cycles.map((c) => (
                <SortableWrap key={c.id} id={c.id}>
                  {(handleProps) => (
                    <CycleNode
                      program={program}
                      phase={phase}
                      cycle={c}
                      sessions={sessions.filter((s) => s.cycle_id === c.id)}
                      sel={sel}
                      onSelect={onSelect}
                      dragHandleProps={handleProps}
                    />
                  )}
                </SortableWrap>
              ))}
            </SortableContext>
          </DndContext>
        </ul>
      )}
    </li>
  );
}

function CycleNode({ program, phase, cycle, sessions, sel, onSelect, dragHandleProps }: {
  program: Program; phase: ProgramPhase; cycle: ProgramCycle; sessions: ProgramSession[];
  sel: Sel; onSelect: (s: Sel) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  const qc = useQueryClient();
  const contains =
    (sel.kind === "cycle" && sel.id === cycle.id) ||
    (sel.kind === "session" && sessions.some((s) => s.id === sel.id));
  const [open, setOpen] = useState(contains);
  useEffect(() => { if (contains) setOpen(true); }, [contains]);
  const active = sel.kind === "cycle" && sel.id === cycle.id;

  const addSession = useMutation({
    mutationFn: async () => {
      const { data: w, error: we } = await supabase.from("workouts").insert({
        name: `Day ${sessions.length + 1}`,
        team_id: program.team_id, organization_id: program.organization_id,
      } as never).select("id").single();
      if (we) throw we;
      const { data: ns, error } = await supabase.from("program_sessions" as never).insert({
        cycle_id: cycle.id, phase_id: phase.id, program_id: program.id,
        organization_id: program.organization_id,
        workout_id: (w as { id: string }).id,
        name: `Day ${sessions.length + 1}`,
        week: 1, day: sessions.length + 1, position: sessions.length,
      } as never).select("id").single();
      if (error) throw error;
      return (ns as { id: string }).id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["program_sessions", program.id] });
      qc.invalidateQueries({ queryKey: ["workouts"] });
      onSelect({ kind: "session", id, programId: program.id });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });
  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("program_cycles" as never).delete().eq("id", cycle.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program_cycles", program.id] });
      qc.invalidateQueries({ queryKey: ["program_sessions", program.id] });
      onSelect({ kind: "phase", id: phase.id, programId: program.id });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  // DnD: reorder sessions within cycle
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const sessionIds = sessions.map((s) => s.id);
  const reorder = useMutation({
    mutationFn: async (ordered: ProgramSession[]) => {
      await Promise.all(ordered.map((s, i) =>
        supabase.from("program_sessions" as never).update({ position: i, day: i + 1 } as never).eq("id", s.id),
      ));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["program_sessions", program.id] }),
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });
  const handleDragEnd = (evt: DragEndEvent) => {
    const { active: a, over } = evt;
    if (!over || a.id === over.id) return;
    const oldIdx = sessionIds.indexOf(String(a.id));
    const newIdx = sessionIds.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(sessions, oldIdx, newIdx);
    qc.setQueryData(["program_sessions", program.id], (prev: ProgramSession[] | undefined) => {
      if (!prev) return prev;
      const others = prev.filter((s) => s.cycle_id !== cycle.id);
      const updated = next.map((s, i) => ({ ...s, position: i, day: i + 1 }));
      return [...others, ...updated].sort((x, y) => (x.week - y.week) || (x.day - y.day) || (x.position - y.position));
    });
    reorder.mutate(next);
  };

  return (
    <li>
      <Row
        active={active}
        onClick={() => onSelect({ kind: "cycle", id: cycle.id, programId: program.id })}
        chevron={<ChevronBtn open={open} onToggle={() => setOpen(!open)} />}
        icon={<CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />}
        label={cycle.name}
        subLabel={`${cycle.weeks}w`}
        badge={`${sessions.length}`}
        dragHandleProps={dragHandleProps}
        menu={
          <>
            <DropdownMenuItem onClick={() => addSession.mutate()}><FilePlus2 className="mr-2 h-3.5 w-3.5" />Add session</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { if (confirm(`Delete cycle "${cycle.name}"?`)) del.mutate(); }} className="text-destructive">
              <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
            </DropdownMenuItem>
          </>
        }
      />
      {open && (
        <ul className="ml-3 border-l pl-1">
          {sessions.length === 0 && (
            <li className="px-2 py-1 text-[11px] text-muted-foreground">
              <button onClick={() => addSession.mutate()} className="inline-flex items-center gap-1 hover:text-foreground">
                <Plus className="h-3 w-3" /> Add session
              </button>
            </li>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sessionIds} strategy={verticalListSortingStrategy}>
              {sessions.map((s) => (
                <SortableWrap key={s.id} id={s.id}>
                  {(handleProps) => (
                    <SessionNode
                      program={program}
                      session={s}
                      sel={sel}
                      onSelect={onSelect}
                      dragHandleProps={handleProps}
                    />
                  )}
                </SortableWrap>
              ))}
            </SortableContext>
          </DndContext>
        </ul>
      )}
    </li>
  );
}

function SessionNode({ program, session, sel, onSelect, dragHandleProps }: {
  program: Program; session: ProgramSession; sel: Sel; onSelect: (s: Sel) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  const qc = useQueryClient();
  const active = sel.kind === "session" && sel.id === session.id;
  const [pickerOpen, setPickerOpen] = useState<"copy" | "move" | null>(null);

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("program_sessions" as never).delete().eq("id", session.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program_sessions", program.id] });
      onSelect({ kind: "cycle", id: session.cycle_id, programId: program.id });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <li>
      <Row
        active={active}
        onClick={() => onSelect({ kind: "session", id: session.id, programId: program.id })}
        icon={<Dumbbell className="h-3.5 w-3.5 text-muted-foreground" />}
        label={session.name}
        subLabel={`W${session.week}·D${session.day}`}
        dragHandleProps={dragHandleProps}
        menu={
          <>
            <DropdownMenuItem onClick={() => setPickerOpen("copy")}><Copy className="mr-2 h-3.5 w-3.5" />Copy to…</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPickerOpen("move")}><ArrowRightLeft className="mr-2 h-3.5 w-3.5" />Move to…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { if (confirm(`Delete "${session.name}"?`)) del.mutate(); }} className="text-destructive">
              <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
            </DropdownMenuItem>
          </>
        }
      />
      {pickerOpen && (
        <DestinationPicker
          mode={pickerOpen}
          session={session}
          onClose={() => setPickerOpen(null)}
        />
      )}
    </li>
  );
}

// ================= DnD sortable wrapper =================
function SortableWrap({ id, children }: {
  id: string;
  children: (handleProps: React.HTMLAttributes<HTMLButtonElement>) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>)}
    </div>
  );
}

// ================= Reusable tree row =================
function ChevronBtn({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
      aria-label={open ? "Collapse" : "Expand"}
    >
      {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
    </button>
  );
}

function Row({
  active, onClick, chevron, icon, label, subLabel, badge, menu, dragHandleProps,
}: {
  active?: boolean;
  onClick: () => void;
  chevron?: React.ReactNode;
  icon: React.ReactNode;
  label: string;
  subLabel?: string;
  badge?: string;
  menu?: React.ReactNode;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group flex cursor-pointer items-center gap-1 rounded-md px-1 py-1 text-sm",
        active ? "bg-primary/10 text-foreground ring-1 ring-primary/40" : "hover:bg-muted",
      )}
    >
      {dragHandleProps && (
        <button
          {...dragHandleProps}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
          aria-label="Drag"
        >
          <GripVertical className="h-3 w-3" />
        </button>
      )}
      <span className="w-4 shrink-0">{chevron}</span>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {subLabel && <span className="shrink-0 text-[10px] text-muted-foreground">{subLabel}</span>}
      {badge && <Badge variant="outline" className="h-4 px-1 text-[10px] leading-none">{badge}</Badge>}
      {menu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label="Actions"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">{menu}</DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ================= DESTINATION PICKER (copy / move session) =================
function DestinationPicker({ mode, session, onClose }: {
  mode: "copy" | "move";
  session: ProgramSession;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [activeOrgId] = useActiveOrgId();
  const { data: programsAll = [] } = useQuery(programsQO);
  const programs = activeOrgId ? programsAll.filter((p) => p.organization_id === activeOrgId) : programsAll;
  const [selected, setSelected] = useState<Set<string>>(new Set()); // cycle_ids

  const toggle = (id: string) => setSelected((s) => {
    if (mode === "move") return new Set([id]);
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const run = useMutation({
    mutationFn: async () => {
      if (selected.size === 0) throw new Error("Pick at least one destination");
      // Look up all cycles across programs to resolve phase_id/program_id
      const cycleIds = Array.from(selected);
      const { data: targetCycles, error: ce } = await supabase
        .from("program_cycles" as never).select("*").in("id", cycleIds);
      if (ce) throw ce;
      const cycles = (targetCycles ?? []) as unknown as ProgramCycle[];

      if (mode === "move") {
        const c = cycles[0];
        const { data: existing } = await supabase.from("program_sessions" as never)
          .select("position").eq("cycle_id", c.id).order("position", { ascending: false }).limit(1);
        const nextPos = ((existing?.[0] as { position?: number } | undefined)?.position ?? -1) + 1;
        const { error } = await supabase.from("program_sessions" as never).update({
          cycle_id: c.id, phase_id: c.phase_id, program_id: c.program_id,
          organization_id: c.organization_id, position: nextPos, day: nextPos + 1,
        } as never).eq("id", session.id);
        if (error) throw error;
      } else {
        // Copy: insert one row per selected cycle, points at same workout
        for (const c of cycles) {
          const { data: existing } = await supabase.from("program_sessions" as never)
            .select("position").eq("cycle_id", c.id).order("position", { ascending: false }).limit(1);
          const nextPos = ((existing?.[0] as { position?: number } | undefined)?.position ?? -1) + 1;
          const { error } = await supabase.from("program_sessions" as never).insert({
            cycle_id: c.id, phase_id: c.phase_id, program_id: c.program_id,
            organization_id: c.organization_id, workout_id: session.workout_id,
            name: session.name, week: session.week, day: nextPos + 1,
            position: nextPos, notes: session.notes,
          } as never);
          if (error) throw error;
        }
      }
      return cycles.map((c) => c.program_id);
    },
    onSuccess: (programIds) => {
      new Set(programIds).forEach((pid) => qc.invalidateQueries({ queryKey: ["program_sessions", pid] }));
      toast.success(mode === "move" ? "Session moved" : `Copied to ${selected.size} destination${selected.size > 1 ? "s" : ""}`);
      onClose();
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "move" ? "Move session to…" : "Copy session to…"}</DialogTitle>
          <DialogDescription>
            {mode === "move"
              ? "Choose one destination cycle/week."
              : "Choose one or more destination cycles/weeks."}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-auto rounded border">
          <ul className="divide-y">
            {programs.map((p) => (
              <ProgramTargetGroup key={p.id} program={p} selected={selected} onToggle={toggle} mode={mode} currentCycleId={session.cycle_id} />
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => run.mutate()} disabled={run.isPending || selected.size === 0}>
            {mode === "move" ? "Move here" : `Copy to ${selected.size || "…"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProgramTargetGroup({ program, selected, onToggle, mode, currentCycleId }: {
  program: Program; selected: Set<string>; onToggle: (id: string) => void;
  mode: "copy" | "move"; currentCycleId: string;
}) {
  const { data: phases = [] } = useQuery(programPhasesQO(program.id));
  const { data: cycles = [] } = useQuery(programCyclesQO(program.id));
  const [open, setOpen] = useState(true);
  return (
    <li className="p-1">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs font-semibold hover:bg-muted">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <FolderKanban className="h-3 w-3 text-primary" />
        <span>{program.name}</span>
      </button>
      {open && (
        <ul className="ml-3 space-y-0.5">
          {phases.map((ph) => (
            <li key={ph.id}>
              <div className="flex items-center gap-1 px-1 py-0.5 text-[11px] text-muted-foreground">
                <Layers className="h-3 w-3" style={{ color: ph.color || undefined }} />
                <span>{ph.name}</span>
              </div>
              <ul className="ml-3">
                {cycles.filter((c) => c.phase_id === ph.id).map((c) => {
                  const disabled = c.id === currentCycleId && mode === "move";
                  return (
                    <li key={c.id}>
                      <label className={cn(
                        "flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted",
                        disabled && "cursor-not-allowed opacity-40",
                      )}>
                        <Checkbox
                          checked={selected.has(c.id)}
                          disabled={disabled}
                          onCheckedChange={() => !disabled && onToggle(c.id)}
                        />
                        <CalendarDays className="h-3 w-3 text-muted-foreground" />
                        <span className="flex-1 truncate">{c.name}</span>
                        <span className="text-[10px] text-muted-foreground">{c.weeks}w</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// ================= DESTINATION PICKER (copy whole cycle) =================
function CycleDestinationPicker({ cycleId, sessions, onClose }: {
  cycleId: string;
  sessions: ProgramSession[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [activeOrgId] = useActiveOrgId();
  const { data: programsAll = [] } = useQuery(programsQO);
  const programs = activeOrgId ? programsAll.filter((p) => p.organization_id === activeOrgId) : programsAll;
  const [selected, setSelected] = useState<Set<string>>(new Set()); // cycle_ids

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const run = useMutation({
    mutationFn: async () => {
      if (selected.size === 0) throw new Error("Pick at least one destination");
      if (sessions.length === 0) throw new Error("This cycle has no sessions to copy");
      const cycleIds = Array.from(selected);
      const { data: targetCycles, error: ce } = await supabase
        .from("program_cycles" as never).select("*").in("id", cycleIds);
      if (ce) throw ce;
      const cycles = (targetCycles ?? []) as unknown as ProgramCycle[];
      const orderedSessions = [...sessions].sort((a, b) => a.position - b.position);

      for (const c of cycles) {
        const { data: existing } = await supabase.from("program_sessions" as never)
          .select("position").eq("cycle_id", c.id).order("position", { ascending: false }).limit(1);
        let nextPos = ((existing?.[0] as { position?: number } | undefined)?.position ?? -1) + 1;
        const payload = orderedSessions.map((s) => {
          const row = {
            cycle_id: c.id, phase_id: c.phase_id, program_id: c.program_id,
            organization_id: c.organization_id, workout_id: s.workout_id,
            name: s.name, week: s.week, day: nextPos + 1,
            position: nextPos, notes: s.notes,
          };
          nextPos += 1;
          return row;
        });
        const { error } = await supabase.from("program_sessions" as never).insert(payload as never);
        if (error) throw error;
      }
      return cycles.map((c) => c.program_id);
    },
    onSuccess: (programIds) => {
      new Set(programIds).forEach((pid) => qc.invalidateQueries({ queryKey: ["program_sessions", pid] }));
      toast.success(`Copied ${sessions.length} session${sessions.length === 1 ? "" : "s"} to ${selected.size} cycle${selected.size === 1 ? "" : "s"}`);
      onClose();
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Copy this cycle to…</DialogTitle>
          <DialogDescription>
            Copies all {sessions.length} session{sessions.length === 1 ? "" : "s"} in this cycle into one or more
            destination cycles/weeks. Sessions point at the same workouts (not duplicated).
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-auto rounded border">
          <ul className="divide-y">
            {programs.map((p) => (
              <ProgramTargetGroup key={p.id} program={p} selected={selected} onToggle={toggle} mode="copy" currentCycleId={cycleId} />
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => run.mutate()} disabled={run.isPending || selected.size === 0}>
            {`Copy to ${selected.size || "…"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= RIGHT EDITOR PANE =================

function EditorPane({ sel, onSelect, programs, onNewProgram }: { sel: Sel; onSelect: (s: Sel) => void; programs: Program[]; onNewProgram?: () => void }) {
  if (sel.kind === "none") {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center">
        <div className="max-w-sm space-y-3">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
            <FolderKanban className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="font-display text-lg">Programming Workspace</div>
          <p className="text-sm text-muted-foreground">
            Pick a program in the tree to edit phases, cycles, and sessions inline.
          </p>
          {onNewProgram && (
            <Button size="sm" onClick={onNewProgram}>
              <Plus className="mr-1 h-4 w-4" /> New program
            </Button>
          )}
        </div>
      </div>
    );
  }
  if (sel.kind === "workout") return <WorkoutFallback workoutId={sel.id} />;
  if (sel.kind === "program") return <ProgramEditor programId={sel.id} onSelect={onSelect} />;
  if (sel.kind === "phase")   return <PhaseEditor phaseId={sel.id} programId={sel.programId} onSelect={onSelect} />;
  if (sel.kind === "cycle")   return <CycleEditor cycleId={sel.id} programId={sel.programId} onSelect={onSelect} />;
  if (sel.kind === "session") return <SessionEditor sessionId={sel.id} programId={sel.programId} />;
  return null;
}

function WorkoutFallback({ workoutId }: { workoutId: string }) {
  const qc = useQueryClient();
  const { data: workouts = [], isLoading } = useQuery(workoutsQO);
  const workout = workouts.find((w) => w.id === workoutId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("workouts").delete().eq("id", workoutId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workouts"] });
      toast.success("Workout deleted");
      setConfirmOpen(false);
      window.history.replaceState(null, "", "/programming");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });
  if (isLoading) return <CenteredSpinner label="Loading workout…" />;
  if (!workout) return <div className="p-6 text-sm text-muted-foreground">Workout not found.</div>;
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Standalone workout</div>
        <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
          <Trash2 className="mr-1 h-3.5 w-3.5" />Delete workout
        </Button>
      </div>
      <WorkoutEditor workout={workout} />
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this workout?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes “{workout.name}”, including its exercises, sets, and assignments. Completed logs are preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate()} disabled={del.isPending}>
              {del.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------- Program edit ----------
function ProgramEditor({ programId, onSelect }: { programId: string; onSelect: (s: Sel) => void }) {
  const qc = useQueryClient();
  const { data: programs = [] } = useQuery(programsQO);
  const program = programs.find((p) => p.id === programId);
  const { data: phases = [] } = useQuery(programPhasesQO(programId));
  const { data: cycles = [] } = useQuery(programCyclesQO(programId));
  const { data: sessions = [] } = useQuery(programSessionsQO(programId));
  const { data: versions = [] } = useQuery(programVersionsQO(programId));

  const [form, setForm] = useState({ name: "", description: "" });
  useEffect(() => {
    if (program) setForm({ name: program.name, description: program.description || "" });
  }, [program?.id]);

  // Advanced programming toggle (per-program, localStorage).
  // Auto-detect existing hierarchy so we never hide it from users who have already built it.
  const advancedKey = `sl.program.advanced.${programId}`;
  const hasHierarchy = phases.length > 1 || cycles.length > 1
    || phases.some((p) => p.name !== "Program")
    || cycles.some((c) => c.name !== "Weeks");
  const [advanced, setAdvancedState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const raw = window.localStorage.getItem(advancedKey);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return hasHierarchy;
  });
  useEffect(() => {
    // If hierarchy appears later (e.g. user opens Advanced and adds phases), keep it on.
    if (hasHierarchy && !advanced) setAdvancedState(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHierarchy]);
  const setAdvanced = (v: boolean) => {
    setAdvancedState(v);
    try { window.localStorage.setItem(advancedKey, String(v)); } catch { /* noop */ }
  };

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("programs" as never).update({
        name: form.name.trim() || program?.name, description: form.description.trim() || null,
      } as never).eq("id", programId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["programs"] }); toast.success("Saved"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  // Quick Start: add a session directly under the default cycle.
  const defaultCycle = cycles[0] ?? null;
  const defaultPhase = phases[0] ?? null;
  const addDay = useMutation({
    mutationFn: async () => {
      if (!defaultCycle || !defaultPhase || !program) throw new Error("Missing default phase/cycle");
      const position = sessions.filter((s) => s.cycle_id === defaultCycle.id).length;
      const { data, error } = await supabase.from("program_sessions" as never).insert({
        cycle_id: defaultCycle.id, phase_id: defaultPhase.id, program_id: programId,
        organization_id: program.organization_id,
        name: `Day ${sessions.length + 1}`,
        week: 1, day: position + 1, position,
      } as never).select("id").single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["program_sessions", programId] });
      onSelect({ kind: "session", id, programId });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  // Version snapshots: a lightweight structural record (phases/cycles/
  // sessions — names, weeks, days, dates) a coach can save before making
  // changes and look back at later. Doesn't capture exercise/set-level
  // detail or support one-click restore — see program_versions' snapshot
  // jsonb for the saved shape.
  const saveVersion = useMutation({
    mutationFn: async () => {
      if (!program) throw new Error("Program not loaded");
      const label = prompt("Label this version (e.g. \"Week 3 draft\", \"Pre-deload\")", `Version ${versions.length + 1}`);
      if (!label || !label.trim()) throw new Error("__cancelled");
      const snapshot = {
        saved_at: new Date().toISOString(),
        phases: phases.map((p) => ({ id: p.id, name: p.name, goal: p.goal, position: p.position })),
        cycles: cycles.map((c) => ({ id: c.id, phase_id: c.phase_id, name: c.name, weeks: c.weeks, position: c.position })),
        sessions: sessions.map((s) => ({
          id: s.id, cycle_id: s.cycle_id, phase_id: s.phase_id, name: s.name,
          week: s.week, day: s.day, position: s.position, scheduled_date: s.scheduled_date,
        })),
      };
      const { error } = await supabase.from("program_versions" as never).insert({
        program_id: programId, organization_id: program.organization_id,
        label: label.trim(), snapshot,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program_versions", programId] });
      toast.success("Version saved");
    },
    onError: (e: Error) => { if (e.message !== "__cancelled") toast.error(toUserMessage(e)); },
  });

  const [deleteVersionId, setDeleteVersionId] = useState<string | null>(null);
  const deleteVersion = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("program_versions" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program_versions", programId] });
      toast.success("Version deleted");
      setDeleteVersionId(null);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  if (!program) return <div className="p-6 text-sm text-muted-foreground">Program not found.</div>;

  const orderedSessions = [...sessions].sort((a, b) => {
    const da = a.scheduled_date ?? ""; const db = b.scheduled_date ?? "";
    if (da && db && da !== db) return da.localeCompare(db);
    return (a.day ?? 0) - (b.day ?? 0) || a.position - b.position;
  });

  return (
    <div className="p-4">
      {/* Header row: program title + advanced toggle */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Program</span>
          <span className="font-display text-lg">{program.name}</span>
          {!advanced && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Zap className="h-3 w-3" /> Quick Start
            </span>
          )}
        </div>
        <label className="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">Advanced programming</span>
          <Switch checked={advanced} onCheckedChange={setAdvanced} />
        </label>
      </div>

      <Card><CardContent className="grid gap-3 p-4 md:grid-cols-2">
        <div>
          <Label>Program name</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <Label>Description</Label>
          <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="md:col-span-2 flex justify-end">
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </div>
      </CardContent></Card>

      {advanced ? (
        <>
          <div className="mb-3 mt-4 grid gap-2 md:grid-cols-4">
            <StatTile label="Phases" value={phases.length} />
            <StatTile label="Cycles" value={cycles.length} />
            <StatTile label="Sessions" value={sessions.length} />
            <StatTile label="Scheduled" value={sessions.filter((s) => s.scheduled_date).length} />
          </div>
          <div className="mt-4">
            <div className="mb-2 text-sm font-semibold">Phases</div>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {phases.map((ph) => {
                const c = cycles.filter((x) => x.phase_id === ph.id);
                const s = sessions.filter((x) => x.phase_id === ph.id);
                return (
                  <button
                    key={ph.id}
                    onClick={() => onSelect({ kind: "phase", id: ph.id, programId })}
                    className="rounded-md border p-3 text-left hover:border-primary/50 hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4" style={{ color: ph.color || undefined }} />
                      <div className="font-medium">{ph.name}</div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{c.length} cycles · {s.length} sessions</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <History className="h-4 w-4 text-muted-foreground" /> Versions
              </div>
              <Button size="sm" variant="outline" onClick={() => saveVersion.mutate()} disabled={saveVersion.isPending}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Save snapshot
              </Button>
            </div>
            {versions.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                No snapshots yet — save one before making a big change so you can look back at how the program was structured.
              </div>
            ) : (
              <ul className="divide-y rounded-md border">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium">
                        v{v.version_number} · {v.label}
                      </div>
                      <div className="text-muted-foreground">
                        {new Date(v.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setDeleteVersionId(v.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <>
          {/* ── QUICK START — flat days list ── */}
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm font-semibold">Training days</div>
            <Button size="sm" onClick={() => addDay.mutate()} disabled={addDay.isPending || !defaultCycle}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add day
            </Button>
          </div>
          {orderedSessions.length === 0 ? (
            <Card className="mt-3 border-dashed">
              <CardContent className="grid gap-3 p-8 text-center">
                <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-primary/10">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <div className="font-medium">Quick Start</div>
                <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                  Add a training day and start programming exercises right away. No phases,
                  cycles, or velocity targets required — flip on Advanced programming above
                  when you want the full periodization model.
                </p>
                <div className="flex justify-center">
                  <Button size="sm" onClick={() => addDay.mutate()} disabled={addDay.isPending || !defaultCycle}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add your first day
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {orderedSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSelect({ kind: "session", id: s.id, programId })}
                  className="rounded-md border p-3 text-left transition hover:border-primary/50 hover:bg-muted/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-primary" />
                      <div className="font-medium">{s.name}</div>
                    </div>
                    {s.scheduled_date && (
                      <Badge variant="outline" className="text-[10px]">{s.scheduled_date}</Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {s.workout_id ? "Workout attached" : "Empty — click to program"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <AlertDialog open={!!deleteVersionId} onOpenChange={(open) => { if (!open) setDeleteVersionId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this version?</AlertDialogTitle>
            <AlertDialogDescription>
              This snapshot will be permanently deleted. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteVersion.mutate(deleteVersionId!)}
              disabled={deleteVersion.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


// ---------- Phase edit ----------
function PhaseEditor({ phaseId, programId, onSelect }: { phaseId: string; programId: string; onSelect: (s: Sel) => void }) {
  const qc = useQueryClient();
  const { data: phases = [] } = useQuery(programPhasesQO(programId));
  const phase = phases.find((p) => p.id === phaseId);
  const { data: cycles = [] } = useQuery(programCyclesQO(programId));
  const { data: sessions = [] } = useQuery(programSessionsQO(programId));
  const phaseCycles = cycles.filter((c) => c.phase_id === phaseId);

  const [form, setForm] = useState({ name: "", goal: "", color: "" });
  useEffect(() => {
    if (phase) setForm({ name: phase.name, goal: phase.goal || "", color: phase.color || "" });
  }, [phase?.id]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("program_phases" as never).update({
        name: form.name.trim(), goal: form.goal.trim() || null, color: form.color.trim() || null,
      } as never).eq("id", phaseId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["program_phases", programId] }); toast.success("Saved"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const addCycle = useMutation({
    mutationFn: async () => {
      if (!phase) throw new Error("Phase not found");
      const { data, error } = await supabase.from("program_cycles" as never).insert({
        phase_id: phase.id, program_id: programId, organization_id: phase.organization_id,
        name: `Week ${phaseCycles.length + 1}`, weeks: 1, position: phaseCycles.length,
      } as never).select("id").single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["program_cycles", programId] });
      toast.success("Cycle added");
      onSelect({ kind: "cycle", id, programId });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  if (!phase) return <div className="p-6 text-sm text-muted-foreground">Phase not found.</div>;


  return (
    <div className="p-4">
      <Card><CardContent className="grid gap-3 p-4 md:grid-cols-3">
        <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><Label>Training goal</Label><Input value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="e.g. Hypertrophy" /></div>
        <div><Label>Color</Label><Input type="color" value={form.color || "#3b82f6"} onChange={(e) => setForm({ ...form, color: e.target.value })} /></div>
        <div className="md:col-span-3 flex justify-end">
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </div>
      </CardContent></Card>
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Cycles</div>
          <Button size="sm" onClick={() => addCycle.mutate()} disabled={addCycle.isPending}>
            <Plus className="mr-1 h-4 w-4" /> Add cycle
          </Button>
        </div>
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {phaseCycles.map((c) => {
            const s = sessions.filter((x) => x.cycle_id === c.id);
            return (
              <button
                key={c.id}
                onClick={() => onSelect({ kind: "cycle", id: c.id, programId })}
                className="rounded-md border p-3 text-left hover:border-primary/50 hover:bg-muted/30"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium">{c.name}</div>
                  <Badge variant="outline" className="text-[10px]">{c.weeks}w</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{s.length} sessions</div>
              </button>
            );
          })}
          {phaseCycles.length === 0 && (
            <button
              onClick={() => addCycle.mutate()}
              disabled={addCycle.isPending}
              className="col-span-full rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
            >
              No cycles yet — tap to add one.
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


// ---------- Cycle edit ----------
function CycleEditor({ cycleId, programId, onSelect }: { cycleId: string; programId: string; onSelect: (s: Sel) => void }) {
  const qc = useQueryClient();
  const { data: cycles = [] } = useQuery(programCyclesQO(programId));
  const cycle = cycles.find((c) => c.id === cycleId);
  const { data: sessions = [] } = useQuery(programSessionsQO(programId));
  const cSessions = sessions.filter((s) => s.cycle_id === cycleId);

  const [form, setForm] = useState({ name: "", weeks: "1", intensity: "", volume: "", focus: "" });
  useEffect(() => {
    if (cycle) setForm({
      name: cycle.name, weeks: String(cycle.weeks),
      intensity: cycle.intensity || "", volume: cycle.volume || "", focus: cycle.focus || "",
    });
  }, [cycle?.id]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("program_cycles" as never).update({
        name: form.name.trim(), weeks: parseInt(form.weeks) || 1,
        intensity: form.intensity.trim() || null, volume: form.volume.trim() || null,
        focus: form.focus.trim() || null,
      } as never).eq("id", cycleId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["program_cycles", programId] }); toast.success("Saved"); },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const { data: programs = [] } = useQuery(programsQO);
  const program = programs.find((p) => p.id === programId);
  const { data: phases = [] } = useQuery(programPhasesQO(programId));
  const [copyOpen, setCopyOpen] = useState(false);

  const addSession = useMutation({
    mutationFn: async () => {
      if (!cycle || !program) throw new Error("Cycle not found");
      const phaseId = cycle.phase_id ?? phases[0]?.id;
      if (!phaseId) throw new Error("Add a phase first");
      const n = cSessions.length + 1;
      const { data: w, error: we } = await supabase.from("workouts").insert({
        name: `Day ${n}`,
        team_id: program.team_id, organization_id: program.organization_id,
      } as never).select("id").single();
      if (we) throw we;
      const { data: ns, error } = await supabase.from("program_sessions" as never).insert({
        cycle_id: cycleId, phase_id: phaseId, program_id: programId,
        organization_id: program.organization_id,
        workout_id: (w as { id: string }).id,
        name: `Day ${n}`,
        week: 1, day: n, position: cSessions.length,
      } as never).select("id").single();
      if (error) throw error;
      return (ns as { id: string }).id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["program_sessions", programId] });
      qc.invalidateQueries({ queryKey: ["workouts"] });
      toast.success("Workout added");
      onSelect({ kind: "session", id, programId });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  if (!cycle) return <div className="p-6 text-sm text-muted-foreground">Cycle not found.</div>;

  return (
    <div className="p-4">
      <Card><CardContent className="grid gap-3 p-4 md:grid-cols-5">
        <div className="md:col-span-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><Label>Weeks</Label><Input type="number" min={1} value={form.weeks} onChange={(e) => setForm({ ...form, weeks: e.target.value })} /></div>
        <div><Label>Intensity</Label><Input value={form.intensity} onChange={(e) => setForm({ ...form, intensity: e.target.value })} placeholder="75-85%" /></div>
        <div><Label>Volume</Label><Input value={form.volume} onChange={(e) => setForm({ ...form, volume: e.target.value })} placeholder="high" /></div>
        <div className="md:col-span-5"><Label>Focus</Label><Input value={form.focus} onChange={(e) => setForm({ ...form, focus: e.target.value })} placeholder="Peak strength / speed / GPP…" /></div>
        <div className="md:col-span-5 flex justify-end">
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </div>
      </CardContent></Card>
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Sessions</div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCopyOpen(true)}
              disabled={cSessions.length === 0}
              title="Copy every session in this cycle to one or more other cycles/weeks"
            >
              <Copy className="mr-1 h-3.5 w-3.5" /> Copy this cycle to…
            </Button>
            <Button size="sm" onClick={() => addSession.mutate()} disabled={addSession.isPending}>
              <Plus className="mr-1 h-4 w-4" /> Add workout
            </Button>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {cSessions.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect({ kind: "session", id: s.id, programId })}
              className="rounded-md border p-3 text-left hover:border-primary/50 hover:bg-muted/30"
            >
              <div className="flex items-center gap-2">
                <Dumbbell className="h-4 w-4 text-muted-foreground" />
                <div className="font-medium">{s.name}</div>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">Week {s.week} · Day {s.day}</div>
            </button>
          ))}
          {cSessions.length === 0 && (
            <button
              onClick={() => addSession.mutate()}
              disabled={addSession.isPending}
              className="col-span-full rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
            >
              No workouts yet — tap to add one.
            </button>
          )}
        </div>
      </div>

      {copyOpen && (
        <CycleDestinationPicker
          cycleId={cycleId}
          sessions={cSessions}
          onClose={() => setCopyOpen(false)}
        />
      )}
    </div>
  );
}

// ---------- Session (workout) edit ----------
function SessionEditor({ sessionId, programId }: { sessionId: string; programId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: sessions = [] } = useQuery(programSessionsQO(programId));
  const session = sessions.find((s) => s.id === sessionId);
  const { data: workouts = [] } = useQuery(workoutsQO);
  const workout: Workout | undefined = session?.workout_id ? workouts.find((w) => w.id === session.workout_id) : undefined;
  const { data: programs = [] } = useQuery(programsQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const program = programs.find((p) => p.id === programId);

  const [name, setName] = useState("");
  useEffect(() => { if (session) setName(session.name); }, [session?.id]);

  const rename = useMutation({
    mutationFn: async () => {
      if (!session) return;
      const { error } = await supabase.from("program_sessions" as never).update({
        name: name.trim() || session.name,
      } as never).eq("id", session.id);
      if (error) throw error;
      if (session.workout_id) {
        await supabase.from("workouts").update({ name: name.trim() || session.name } as never).eq("id", session.workout_id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program_sessions", programId] });
      qc.invalidateQueries({ queryKey: ["workouts"] });
      toast.success("Renamed");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const attach = useMutation({
    mutationFn: async () => {
      if (!session || !program) return;
      const { data: w, error } = await supabase.from("workouts").insert({
        name: session.name, team_id: program.team_id, organization_id: program.organization_id,
      } as never).select("id").single();
      if (error) throw error;
      const { error: e2 } = await supabase.from("program_sessions" as never).update({
        workout_id: (w as { id: string }).id,
      } as never).eq("id", session.id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program_sessions", programId] });
      qc.invalidateQueries({ queryKey: ["workouts"] });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  // Duplicate this session as a new sibling Day in the same cycle — copies the
  // workout's exercises/sets via duplicateWorkout(), then attaches the copy
  // via a new program_sessions row so it shows up in the tree right away
  // (duplicateWorkout only re-attaches through the legacy program_workouts
  // table, which this hierarchy doesn't use).
  const duplicateSession = useMutation({
    mutationFn: async () => {
      if (!session || !workout || !program) throw new Error("Nothing to duplicate yet");
      const newWorkout = await duplicateWorkout(workout.id, { name: session.name });
      const siblings = sessions.filter((s) => s.cycle_id === session.cycle_id);
      const { data: ns, error } = await supabase.from("program_sessions" as never).insert({
        cycle_id: session.cycle_id, phase_id: session.phase_id, program_id: program.id,
        organization_id: program.organization_id,
        workout_id: newWorkout.id,
        name: `${session.name} (copy)`,
        week: session.week, day: siblings.length + 1, position: siblings.length,
      } as never).select("id").single();
      if (error) throw error;
      return (ns as { id: string }).id;
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ["program_sessions", programId] });
      qc.invalidateQueries({ queryKey: ["workouts"] });
      toast.success("Session duplicated");
      navigate({ to: "/programming", search: selToSearch({ kind: "session", id: newId, programId }), replace: false });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const [confirmDelWorkout, setConfirmDelWorkout] = useState(false);
  const delWorkout = useMutation({
    mutationFn: async () => {
      if (!workout) return;
      const { error: e1 } = await supabase.from("program_sessions" as never).update({ workout_id: null } as never).eq("id", sessionId);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("workouts").delete().eq("id", workout.id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program_sessions", programId] });
      qc.invalidateQueries({ queryKey: ["workouts"] });
      toast.success("Workout deleted");
      setConfirmDelWorkout(false);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  if (!session) return <div className="p-6 text-sm text-muted-foreground">Session not found.</div>;


  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Session · Week {session.week} · Day {session.day}
          </div>
          <div className="truncate font-display text-base">{session.name}</div>
        </div>
        <div className="flex items-center gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-52" />
          <Button size="sm" variant="outline" onClick={() => rename.mutate()} disabled={rename.isPending}>
            <Pencil className="mr-1 h-3.5 w-3.5" />Rename
          </Button>
          {workout && (
            <Button size="sm" variant="outline" onClick={() => setConfirmDelWorkout(true)}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />Delete workout
            </Button>
          )}
        </div>
      </div>
      {!workout ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Dumbbell className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">No workout attached to this session</div>
            <Button size="sm" onClick={() => attach.mutate()} disabled={attach.isPending}>
              <Plus className="mr-1 h-4 w-4" /> Create workout for this session
            </Button>
          </CardContent>
        </Card>
      ) : (
        <WorkoutEditor
          workout={workout}
          programContext={program ? {
            programId: program.id,
            teamId: program.team_id,
            teamName: program.team_id ? (teams.find((t) => t.id === program.team_id)?.name ?? null) : null,
            onDuplicateSession: () => duplicateSession.mutate(),
            duplicatingSession: duplicateSession.isPending,
          } : undefined}
        />
      )}
      <AlertDialog open={confirmDelWorkout} onOpenChange={setConfirmDelWorkout}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this workout?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the workout, its exercises, sets, and assignments. The session stays and you can attach a new workout to it. Completed logs are preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => delWorkout.mutate()} disabled={delWorkout.isPending}>
              {delWorkout.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ================= Bits =================

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-xl">{value}</div>
    </CardContent></Card>
  );
}

function NewProgramDialog({ open, onOpenChange, teams, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  teams: { id: string; name: string; organization_id: string }[];
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", description: "", team_id: "" });
  const create = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name required");
      const team = teams.find((t) => t.id === form.team_id);
      const orgId = team?.organization_id;
      if (!orgId) throw new Error("Pick a team");
      const { data, error } = await supabase.from("programs" as never).insert({
        name: form.name.trim(), description: form.description.trim() || null,
        team_id: form.team_id, organization_id: orgId, weeks: null,
      } as never).select("id").single();
      if (error) throw error;
      const programId = (data as { id: string }).id;
      // Auto-create a default Phase + Cycle so Quick Start users can add sessions
      // without opening the periodization model. Advanced mode reveals + edits these.
      const { data: phaseRow, error: pErr } = await supabase.from("program_phases" as never).insert({
        program_id: programId, organization_id: orgId, name: "Program", position: 0,
      } as never).select("id").single();
      if (pErr) throw pErr;
      const phaseId = (phaseRow as { id: string }).id;
      await supabase.from("program_cycles" as never).insert({
        program_id: programId, organization_id: orgId, phase_id: phaseId,
        name: "Weeks", weeks: 1, position: 0,
      } as never);
      // Default new programs to Quick Start mode
      try { window.localStorage.setItem(`sl.program.advanced.${programId}`, "false"); } catch { /* noop */ }
      return programId;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["program_phases", id] });
      qc.invalidateQueries({ queryKey: ["program_cycles", id] });
      toast.success("Program created");
      setForm({ name: "", description: "", team_id: "" });
      onOpenChange(false);
      onCreated(id);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New program</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. DHS Football" /></div>
          <div><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div>
            <Label>Team *</Label>
            <Select value={form.team_id} onValueChange={(v) => setForm({ ...form, team_id: v })}>
              <SelectTrigger><SelectValue placeholder="Pick a team" /></SelectTrigger>
              <SelectContent>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
