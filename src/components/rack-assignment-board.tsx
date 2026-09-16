// Pre-practice rack assignment: drag athletes onto numbered racks (4 per
// rack). Reads/writes the same rack_sessions/rack_session_athletes rows the
// live Training View (rack-console.tsx) and Program Delivery's rack sheets
// already read — this is the piece that was missing: an actual builder for
// them, instead of Training View's hardcoded single rack per team per day.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  athletesQO,
  athleteTeamsQO,
  teamsQO,
  repMaxesQO,
  athleteDisplayName,
  type Athlete,
} from "@/lib/queries";
import { rosterForTeam } from "@/lib/program-delivery";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { estimate1RM } from "@/lib/one-rm";
import { getOrg1RMFormula } from "@/hooks/use-1rm-formula";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { EmptyState } from "@/components/page-header";
import { ArrowDownWideNarrow, Plus, Search, Trash2, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";

const RACK_CAPACITY = 4;
const today = () => new Date().toISOString().slice(0, 10);

type RackRow = { id: string; team_id: string; rack_number: number };
type RackMember = { rack_session_id: string; athlete_id: string; quadrant: number };
type RackGroup = RackRow & { athletes: Athlete[] };

export function RackAssignmentBoard() {
  const qc = useQueryClient();
  const [activeTeamId, setActiveTeamId] = useActiveTeamId();
  const teamId = activeTeamId ?? "";
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: athleteTeams = [] } = useQuery(athleteTeamsQO);
  const { data: repMaxes = [] } = useQuery(repMaxesQO);
  const [search, setSearch] = useState("");
  const [dragAthleteId, setDragAthleteId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RackRow | null>(null);
  const [sortExercise, setSortExercise] = useState<string>("");

  useEffect(() => { setSortExercise(""); }, [teamId]);

  const roster = useMemo(
    () => rosterForTeam(athletes, athleteTeams, teamId || null),
    [athletes, athleteTeams, teamId],
  );
  const rosterById = useMemo(() => new Map(roster.map((a) => [a.id, a])), [roster]);

  const rosterIds = useMemo(() => new Set(roster.map((a) => a.id)), [roster]);
  const liftOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of repMaxes) if (rosterIds.has(r.athlete_id)) s.add(r.exercise_name);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [repMaxes, rosterIds]);

  // Best estimated 1RM per athlete for the selected lift — used to sort the
  // roster and rack cards so a coach can group similarly-loaded athletes
  // together (fewer plate changes per rack).
  const weightByAthlete = useMemo(() => {
    const m = new Map<string, number>();
    if (!sortExercise) return m;
    const formula = getOrg1RMFormula();
    for (const r of repMaxes) {
      if (r.exercise_name !== sortExercise) continue;
      const est = estimate1RM(r.load, r.reps, formula) ?? r.load;
      const cur = m.get(r.athlete_id);
      if (cur == null || est > cur) m.set(r.athlete_id, est);
    }
    return m;
  }, [repMaxes, sortExercise]);

  const byWeightDesc = useMemo(() => {
    if (!sortExercise) return null;
    return (a: Athlete, b: Athlete) => {
      const wa = weightByAthlete.get(a.id);
      const wb = weightByAthlete.get(b.id);
      if (wa == null && wb == null) return athleteDisplayName(a).localeCompare(athleteDisplayName(b));
      if (wa == null) return 1;
      if (wb == null) return -1;
      return wb - wa;
    };
  }, [sortExercise, weightByAthlete]);

  const racksQ = useQuery({
    queryKey: ["rack-assignment-racks", teamId, today()],
    enabled: !!teamId,
    queryFn: async (): Promise<RackRow[]> => {
      const { data, error } = await supabase
        .from("rack_sessions")
        .select("id, team_id, rack_number")
        .eq("team_id", teamId)
        .eq("session_date", today())
        .order("rack_number");
      if (error) throw error;
      return (data ?? []) as unknown as RackRow[];
    },
  });
  const racks = racksQ.data ?? [];
  const rackIdsKey = racks.map((r) => r.id).join(",");

  const membersQ = useQuery({
    queryKey: ["rack-assignment-members", rackIdsKey],
    enabled: racks.length > 0,
    queryFn: async (): Promise<RackMember[]> => {
      const { data, error } = await supabase
        .from("rack_session_athletes")
        .select("rack_session_id, athlete_id, quadrant")
        .in(
          "rack_session_id",
          racks.map((r) => r.id),
        )
        .order("quadrant");
      if (error) throw error;
      return (data ?? []) as RackMember[];
    },
  });
  const members = membersQ.data ?? [];

  const rackGroups = useMemo<RackGroup[]>(
    () =>
      racks.map((r) => {
        const members_ = members
          .filter((m) => m.rack_session_id === r.id)
          .sort((a, b) => a.quadrant - b.quadrant)
          .map((m) => rosterById.get(m.athlete_id))
          .filter((a): a is Athlete => !!a);
        return { ...r, athletes: byWeightDesc ? [...members_].sort(byWeightDesc) : members_ };
      }),
    [racks, members, rosterById, byWeightDesc],
  );

  const assignedIds = useMemo(() => new Set(members.map((m) => m.athlete_id)), [members]);
  const unassigned = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return roster
      .filter((a) => !assignedIds.has(a.id))
      .filter(
        (a) =>
          !needle ||
          athleteDisplayName(a).toLowerCase().includes(needle) ||
          (a.position ?? "").toLowerCase().includes(needle),
      )
      .sort(byWeightDesc ?? ((a, b) => athleteDisplayName(a).localeCompare(athleteDisplayName(b))));
  }, [roster, assignedIds, search, byWeightDesc]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["rack-assignment-racks"] });
    void qc.invalidateQueries({ queryKey: ["rack-assignment-members"] });
  };

  const addRack = useMutation({
    mutationFn: async () => {
      const team = teams.find((t) => t.id === teamId);
      const organization_id = team?.organization_id ?? (await getScopedOrgId());
      const nextNumber = racks.reduce((max, r) => Math.max(max, r.rack_number), 0) + 1;
      const { error } = await supabase.from("rack_sessions").insert({
        organization_id,
        team_id: teamId,
        rack_number: nextNumber,
        session_date: today(),
        athlete_ids: [],
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const deleteRack = useMutation({
    mutationFn: async (rack: RackRow) => {
      const { error: memberErr } = await supabase
        .from("rack_session_athletes")
        .delete()
        .eq("rack_session_id", rack.id);
      if (memberErr) throw memberErr;
      const { error: rackErr } = await supabase.from("rack_sessions").delete().eq("id", rack.id);
      if (rackErr) throw rackErr;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Rack removed");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const assign = useMutation({
    mutationFn: async (input: { athleteId: string; rackSessionId: string }) => {
      const taken = new Set(
        members.filter((m) => m.rack_session_id === input.rackSessionId).map((m) => m.quadrant),
      );
      let quadrant = 1;
      while (taken.has(quadrant)) quadrant++;
      if (quadrant > RACK_CAPACITY) throw new Error(`Rack is full (max ${RACK_CAPACITY})`);
      // Moving between racks: the unique key is (rack_session_id, athlete_id),
      // so a straight upsert would leave the old row behind — drop it first.
      const prior = members.find((m) => m.athlete_id === input.athleteId);
      if (prior && prior.rack_session_id !== input.rackSessionId) {
        const { error } = await supabase
          .from("rack_session_athletes")
          .delete()
          .eq("rack_session_id", prior.rack_session_id)
          .eq("athlete_id", input.athleteId);
        if (error) throw error;
      }
      const { error } = await supabase.from("rack_session_athletes").upsert(
        {
          rack_session_id: input.rackSessionId,
          athlete_id: input.athleteId,
          quadrant,
          override_reason: "assigned",
        },
        { onConflict: "rack_session_id,athlete_id" },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const unassign = useMutation({
    mutationFn: async (input: { athleteId: string; rackSessionId: string }) => {
      const { error } = await supabase
        .from("rack_session_athletes")
        .delete()
        .eq("rack_session_id", input.rackSessionId)
        .eq("athlete_id", input.athleteId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    setDragAthleteId(null);
    const { active, over } = event;
    if (!over) return;
    const athleteId = String(active.id);

    if (over.id === "unassigned-zone") {
      const prior = members.find((m) => m.athlete_id === athleteId);
      if (prior) unassign.mutate({ athleteId, rackSessionId: prior.rack_session_id });
      return;
    }

    const rackSessionId = String(over.id);
    if (!racks.some((r) => r.id === rackSessionId)) return;
    if (members.some((m) => m.athlete_id === athleteId && m.rack_session_id === rackSessionId))
      return;
    const count = members.filter((m) => m.rack_session_id === rackSessionId).length;
    if (count >= RACK_CAPACITY) {
      toast.error(`Rack is full (max ${RACK_CAPACITY})`);
      return;
    }
    assign.mutate({ athleteId, rackSessionId });
  };

  const dragAthlete = dragAthleteId ? (rosterById.get(dragAthleteId) ?? null) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Training Group
          </label>
          <Select value={teamId} onValueChange={setActiveTeamId}>
            <SelectTrigger className="mt-1 h-9 w-[220px]">
              <SelectValue placeholder="Select team" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {teamId && (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Sort by weight
              </label>
              <div className="mt-1 flex items-center gap-1">
                <Select value={sortExercise} onValueChange={setSortExercise} disabled={!liftOptions.length}>
                  <SelectTrigger className="h-9 w-[180px]">
                    <ArrowDownWideNarrow className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <SelectValue placeholder={liftOptions.length ? "Pick a lift…" : "No rep maxes on file"} />
                  </SelectTrigger>
                  <SelectContent>
                    {liftOptions.map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {sortExercise && (
                  <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground" onClick={() => setSortExercise("")}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <Button size="sm" onClick={() => addRack.mutate()} disabled={addRack.isPending}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add rack
            </Button>
          </div>
        )}
      </div>

      {!teamId ? (
        <EmptyState
          icon={Users}
          title="Pick a training group"
          description="Choose a team above to build today's rack assignments."
        />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={(e) => setDragAthleteId(String(e.active.id))}
          onDragEnd={handleDragEnd}
        >
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[280px_1fr]">
            <RosterPanel
              athletes={unassigned}
              search={search}
              onSearch={setSearch}
              total={roster.length}
              assignedCount={assignedIds.size}
              weightByAthlete={weightByAthlete}
            />
            <div className="min-h-0 overflow-y-auto pr-1">
              {rackGroups.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No racks yet"
                  description='Click "Add rack" to start assigning athletes.'
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {rackGroups.map((r) => (
                    <RackCard key={r.id} rack={r} onDelete={() => setDeleteTarget(r)} weightByAthlete={weightByAthlete} />
                  ))}
                </div>
              )}
            </div>
          </div>
          <DragOverlay>
            {dragAthlete ? <AthleteChipPreview athlete={dragAthlete} weight={weightByAthlete.get(dragAthlete.id)} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Rack {deleteTarget?.rack_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes this rack and its athlete assignments for today. Sets already logged against
              it stay on record — this only clears the rack itself.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deleteRack.mutate(deleteTarget);
                setDeleteTarget(null);
              }}
              disabled={deleteRack.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RosterPanel({
  athletes,
  search,
  onSearch,
  total,
  assignedCount,
  weightByAthlete,
}: {
  athletes: Athlete[];
  search: string;
  onSearch: (v: string) => void;
  total: number;
  assignedCount: number;
  weightByAthlete: Map<string, number>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "unassigned-zone" });
  return (
    <Card className={cn("flex min-h-0 flex-col", isOver && "ring-2 ring-primary")}>
      <CardHeader className="gap-2 pb-2">
        <div className="text-sm font-semibold">Roster</div>
        <div className="text-xs text-muted-foreground">
          {assignedCount} of {total} assigned · {athletes.length} to place
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name, position, tag..."
            className="h-8 pl-8 text-xs"
          />
        </div>
      </CardHeader>
      <CardContent ref={setNodeRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto pt-0">
        {athletes.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {search ? "No matches." : "Everyone is assigned."}
          </div>
        ) : (
          athletes.map((a) => <AthleteChip key={a.id} athlete={a} weight={weightByAthlete.get(a.id)} />)
        )}
      </CardContent>
    </Card>
  );
}

function RackCard({
  rack, onDelete, weightByAthlete,
}: {
  rack: RackGroup; onDelete: () => void; weightByAthlete: Map<string, number>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: rack.id });
  const full = rack.athletes.length >= RACK_CAPACITY;
  return (
    <Card
      className={cn(
        "flex flex-col",
        isOver && !full && "ring-2 ring-primary",
        isOver && full && "ring-2 ring-destructive",
      )}
    >
      <CardHeader className="flex-row items-center justify-between gap-2 pb-2 space-y-0">
        <div className="text-sm font-semibold">Rack {rack.rack_number}</div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-xs font-medium tabular-nums",
              full ? "text-primary" : "text-muted-foreground",
            )}
          >
            {rack.athletes.length}/{RACK_CAPACITY}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent ref={setNodeRef} className="min-h-[120px] flex-1 space-y-1 pt-0">
        {rack.athletes.map((a) => (
          <AthleteChip key={a.id} athlete={a} weight={weightByAthlete.get(a.id)} />
        ))}
        {Array.from({ length: RACK_CAPACITY - rack.athletes.length }).map((_, i) => (
          <div
            key={i}
            className="rounded-md border border-dashed border-border/50 px-2 py-1.5 text-center text-[11px] text-muted-foreground/60"
          >
            Drop athlete here
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AthleteChip({ athlete, weight }: { athlete: Athlete; weight?: number }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: athlete.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "flex cursor-grab items-center gap-2 rounded-md border border-border/50 bg-card px-2 py-1.5 text-xs active:cursor-grabbing",
        isDragging && "opacity-30",
      )}
    >
      <AthleteAvatar name={athleteDisplayName(athlete)} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{athleteDisplayName(athlete)}</div>
        {athlete.position && (
          <div className="truncate text-[10px] text-muted-foreground">{athlete.position}</div>
        )}
      </div>
      {weight != null && (
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
          {Math.round(weight)} lb
        </span>
      )}
    </div>
  );
}

function AthleteChipPreview({ athlete, weight }: { athlete: Athlete; weight?: number }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-card px-2 py-1.5 text-xs shadow-lg">
      <AthleteAvatar name={athleteDisplayName(athlete)} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{athleteDisplayName(athlete)}</div>
      </div>
      {weight != null && (
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
          {Math.round(weight)} lb
        </span>
      )}
    </div>
  );
}

function AthleteAvatar({ name }: { name: string }) {
  const p = name.trim().split(/\s+/);
  const initials = ((p[0]?.[0] ?? "") + (p[p.length - 1]?.[0] ?? "")).toUpperCase() || "?";
  return (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
      {initials}
    </div>
  );
}
