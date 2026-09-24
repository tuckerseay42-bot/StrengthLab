import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { athletesQO, teamsQO, programsQO, athleteTeamsQO, athleteDisplayName, titleCaseName, type Athlete } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { Filters, emptyFilters, filterAthletes } from "@/components/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Download, Pencil, Trash2, ExternalLink, Users, Mail, Send, RotateCcw, CheckSquare, Filter } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useServerFn } from "@tanstack/react-start";
import { sendPinSetupEmails } from "@/lib/pin-invite.functions";
import { publicOrigin } from "@/lib/share-url";
import { PageHeader, EmptyState } from "@/components/page-header";
import { PageSkeleton } from "@/components/loading";
import { SPORTS, GRADES, GENDERS, GENDER_LABELS, downloadCSV, gradeToGradYear, gradYearToGrade } from "@/lib/domain";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { useUnitPrefs } from "@/hooks/use-units";
import { fromLb, toLb, fromIn, toIn } from "@/lib/units";
import { athleteInputSchema, findDuplicateAthlete } from "@/lib/validation";
import { usePermission } from "@/hooks/use-permissions";
import { DuplicateAthletesBanner, useDuplicateAthletes } from "@/components/athlete-duplicates";
import { getScopedOrgId } from "@/lib/scoped-insert";

export const Route = createFileRoute("/athletes")({
  head: () => ({ meta: [{ title: "Athletes — Strength Lab" }] }),
  validateSearch: (s: Record<string, unknown>): { edit?: string } => ({
    edit: typeof s.edit === "string" ? s.edit : undefined,
  }),
  component: AthletesPage,
});

type Form = {
  first_name: string; last_name: string;
  student_id: string; graduation_year: string; height_in: string;
  parent_email: string; athlete_email: string; status: string;
  team_id: string; grade: string; sport: string;
  gender: string;
  date_of_birth: string;
  sport_fall: string; sport_winter: string; sport_spring: string;
  bodyweight: string; notes: string; photo_url: string;
  program_id: string; program_start_date: string;
  class_period: string;
  training_group: string; tags: string;
};
const emptyForm: Form = {
  first_name: "", last_name: "", student_id: "",
  graduation_year: "", height_in: "", parent_email: "", athlete_email: "",
  status: "active", team_id: "", grade: "", sport: "",
  gender: "",
  date_of_birth: "",
  sport_fall: "", sport_winter: "", sport_spring: "",
  bodyweight: "", notes: "", photo_url: "",
  program_id: "", program_start_date: "",
  class_period: "",
  training_group: "", tags: "",
};

// Tags are entered as a comma-separated list in the form and stored as a
// deduped, order-preserving text[] column.
function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(",")) {
    const t = raw.trim();
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out;
}

function genderLabel(g: string | null): string {
  if (!g) return "—";
  return (GENDER_LABELS as Record<string, string>)[g] ?? g;
}

function RosterAvatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const parts = name.trim().split(/\s+/);
  const initials = ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase() || "?";
  return (
    <Avatar className="h-7 w-7 shrink-0">
      {photoUrl && <AvatarImage src={photoUrl} alt={name} />}
      <AvatarFallback className="text-[10px] font-semibold">{initials}</AvatarFallback>
    </Avatar>
  );
}

function AthletesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { edit: editId } = Route.useSearch();
  const { data: athletes = [], isLoading } = useQuery(athletesQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: programs = [] } = useQuery(programsQO);
  const { data: athleteTeams = [] } = useQuery(athleteTeamsQO);
  const [activeTeamId, setActiveTeamId] = useActiveTeamId();
  const [prefs] = useUnitPrefs();
  const { allowed: canAssignProgram } = usePermission("workouts.edit");
  const [filters, setFilters] = useState({ ...emptyFilters, from: "", to: "" });
  const [classPeriodFilter, setClassPeriodFilter] = useState<string>("all");
  const [trainingGroupFilter, setTrainingGroupFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Athlete | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    team_id: "__keep", status: "__keep", grade: "__keep", sport: "__keep",
    gender: "__keep", class_period: "__keep", program_id: "__keep", training_group: "__keep",
  });
  const [pinInviteConfirmOpen, setPinInviteConfirmOpen] = useState(false);
  const [resetPinTarget, setResetPinTarget] = useState<Athlete | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Athlete | null>(null);


  const { groups: dupGroups, duplicateIds, dismiss: dismissDup } = useDuplicateAthletes(athletes);

  const teamsByAthlete = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const row of athleteTeams) {
      if (!row.athlete_id || !row.team_id) continue;
      let set = m.get(row.athlete_id);
      if (!set) { set = new Set(); m.set(row.athlete_id, set); }
      set.add(row.team_id);
    }
    return m;
  }, [athleteTeams]);

  const classPeriodOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of athletes) if (a.class_period?.trim()) s.add(a.class_period.trim());
    return Array.from(s).sort();
  }, [athletes]);
  const trainingGroupOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of athletes) if (a.training_group?.trim()) s.add(a.training_group.trim());
    return Array.from(s).sort();
  }, [athletes]);
  const tagOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of athletes) for (const t of a.tags ?? []) if (t.trim()) s.add(t.trim());
    return Array.from(s).sort();
  }, [athletes]);

  const filtered = useMemo(() => {
    let base = filterAthletes(athletes, filters, activeTeamId, teamsByAthlete);
    if (classPeriodFilter === "__none") base = base.filter((a) => !a.class_period);
    else if (classPeriodFilter !== "all") base = base.filter((a) => a.class_period === classPeriodFilter);
    if (trainingGroupFilter === "__none") base = base.filter((a) => !a.training_group);
    else if (trainingGroupFilter !== "all") base = base.filter((a) => a.training_group === trainingGroupFilter);
    if (tagFilter === "__none") base = base.filter((a) => (a.tags ?? []).length === 0);
    else if (tagFilter !== "all") base = base.filter((a) => (a.tags ?? []).includes(tagFilter));
    return base;
  }, [athletes, filters, activeTeamId, teamsByAthlete, classPeriodFilter, trainingGroupFilter, tagFilter]);
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const allSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.id));
  const toggleSelectAllFiltered = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) filtered.forEach((a) => next.delete(a.id));
      else filtered.forEach((a) => next.add(a.id));
      return next;
    });




  const save = useMutation({
    mutationFn: async () => {
      const first = titleCaseName(form.first_name.trim());
      const last = titleCaseName(form.last_name.trim());
      const displayName = `${first} ${last}`.trim();

      // Convert display-unit inputs to canonical (lb, in)
      const bwDisplay = form.bodyweight ? Number(form.bodyweight) : null;
      const htDisplay = form.height_in ? Number(form.height_in) : null;
      const bodyweightLb = bwDisplay != null && Number.isFinite(bwDisplay) ? toLb(bwDisplay, prefs.weight) : null;
      const heightIn = htDisplay != null && Number.isFinite(htDisplay) ? toIn(htDisplay, prefs.distance) : null;

      // Zod validation
      const parsed = athleteInputSchema.safeParse({
        first_name: first,
        last_name: last,
        grade: form.grade ? Number(form.grade) : null,
        bodyweight: bodyweightLb,
        height_in: heightIn,
        athlete_email: form.athlete_email.trim(),
        parent_email: form.parent_email.trim(),
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
      }

      // Duplicate check
      const dup = findDuplicateAthlete(athletes, displayName, editing?.id);
      if (dup) throw new Error(`An athlete named "${displayName}" already exists`);

      const payload = {
        name: displayName,
        first_name: first || null,
        last_name: last || null,
        student_id: form.student_id.trim() || null,
        graduation_year: form.graduation_year ? Number(form.graduation_year) : null,
        height_in: heightIn,
        parent_email: form.parent_email.trim() || null,
        athlete_email: form.athlete_email.trim() || null,
        status: form.status || "active",
        team_id: form.team_id || null,
        grade: form.grade ? Number(form.grade) : null,
        sport: form.sport || null,
        gender: form.gender || null,
        date_of_birth: form.date_of_birth || null,
        sport_fall: form.sport_fall || null,
        sport_winter: form.sport_winter || null,
        sport_spring: form.sport_spring || null,
        bodyweight: bodyweightLb,
        notes: form.notes.trim() || null,
        photo_url: form.photo_url.trim() || null,
        program_id: form.program_id || null,
        program_start_date: form.program_start_date || null,
        class_period: form.class_period.trim() || null,
        training_group: form.training_group.trim() || null,
        // `tags` predates the generated Supabase types picking it up (added in
        // migration 20260915120000) — cast through `never` like bulkEdit does
        // below for the same reason.
        tags: parseTags(form.tags),
      };
      if (editing) {
        const { error } = await supabase.from("athletes").update(payload as never).eq("id", editing.id);
        if (error) throw error;
      } else {
        // Pin the row to the org currently being viewed — the DB default falls
        // back to the signed-in user's own org, which makes the new athlete
        // vanish from a roster that's filtered to a different org.
        const organization_id = await getScopedOrgId();
        const { error } = await supabase.from("athletes").insert({ ...payload, organization_id } as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["athletes"] });
      toast.success(editing ? "Athlete updated" : "Athlete added");
      setOpen(false); setEditing(null); setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("athletes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["athletes"] });
      qc.invalidateQueries({ queryKey: ["tests"] });
      qc.invalidateQueries({ queryKey: ["lifts"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
      toast.success("Athlete removed");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const sendPinEmails = useServerFn(sendPinSetupEmails);
  const eligibleForPinInvite = useMemo(() => {
    return filtered.filter((a) => {
      const email = (a.athlete_email ?? "").trim();
      const status = (a as unknown as { invite_status?: string }).invite_status ?? "not_invited";
      return !!email && status !== "pin_set" && status !== "active";
    });
  }, [filtered]);
  const pinInvite = useMutation({
    mutationFn: async (args: { ids: string[]; mode?: "invite" | "reset" }) => {
      if (!args.ids.length) throw new Error("No athletes with an email on file to invite.");
      return sendPinEmails({
        data: { athleteIds: args.ids, redirectOrigin: publicOrigin(), mode: args.mode ?? "invite" },
      });
    },
    onSuccess: (r, vars) => {
      qc.invalidateQueries({ queryKey: ["athletes"] });
      const label = vars.mode === "reset" ? "PIN reset email" : "PIN setup email";
      if (r.failed === 0) toast.success(`Sent ${label} to ${r.sent} athlete${r.sent === 1 ? "" : "s"}`);
      else toast.warning(`Sent ${r.sent} · Failed ${r.failed}`, { description: r.failures[0]?.error });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const bulkEdit = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected);
      if (!ids.length) throw new Error("Select at least one athlete");
      const payload: Record<string, unknown> = {};
      if (bulkForm.team_id !== "__keep") payload.team_id = bulkForm.team_id === "__none" ? null : bulkForm.team_id;
      if (bulkForm.status !== "__keep") payload.status = bulkForm.status;
      if (bulkForm.grade !== "__keep") payload.grade = bulkForm.grade === "__none" ? null : Number(bulkForm.grade);
      if (bulkForm.sport !== "__keep") payload.sport = bulkForm.sport === "__none" ? null : bulkForm.sport;
      if (bulkForm.gender !== "__keep") payload.gender = bulkForm.gender === "__none" ? null : bulkForm.gender;
      if (bulkForm.class_period !== "__keep") payload.class_period = bulkForm.class_period.trim() || null;
      if (bulkForm.training_group !== "__keep") payload.training_group = bulkForm.training_group.trim() || null;
      if (bulkForm.program_id !== "__keep") {
        payload.program_id = bulkForm.program_id === "__none" ? null : bulkForm.program_id;
        payload.program_start_date = payload.program_id ? new Date().toISOString().slice(0, 10) : null;
      }
      if (!Object.keys(payload).length) throw new Error("Choose at least one field to change");
      const { error } = await supabase.from("athletes").update(payload as never).in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["athletes"] });
      toast.success(`Updated ${n} athlete${n === 1 ? "" : "s"}`);
      setBulkOpen(false);
      setSelected(new Set());
      setBulkForm({ team_id: "__keep", status: "__keep", grade: "__keep", sport: "__keep", gender: "__keep", class_period: "__keep", program_id: "__keep", training_group: "__keep" });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });




  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm, team_id: activeTeamId ?? teams[0]?.id ?? "" });
    setOpen(true);
  };
  const openEdit = (a: Athlete) => {
    setEditing(a);
    setForm({
      first_name: a.first_name ?? a.name.split(" ")[0] ?? "",
      last_name: a.last_name ?? a.name.split(" ").slice(1).join(" ") ?? "",
      student_id: a.student_id ?? "",
      graduation_year: a.graduation_year ? String(a.graduation_year) : "",
      height_in: a.height_in != null ? String(+fromIn(a.height_in, prefs.distance).toFixed(2)) : "",
      parent_email: a.parent_email ?? "",
      athlete_email: a.athlete_email ?? "",
      status: a.status ?? "active",
      team_id: a.team_id ?? "",
      grade: a.grade ? String(a.grade) : "",
      sport: a.sport ?? "",
      gender: (a as unknown as { gender: string | null }).gender ?? "",
      date_of_birth: (a as unknown as { date_of_birth: string | null }).date_of_birth ?? "",
      sport_fall: (a as unknown as { sport_fall: string | null }).sport_fall ?? "",
      sport_winter: (a as unknown as { sport_winter: string | null }).sport_winter ?? "",
      sport_spring: (a as unknown as { sport_spring: string | null }).sport_spring ?? "",
      bodyweight: a.bodyweight != null ? String(+fromLb(a.bodyweight, prefs.weight).toFixed(1)) : "",
      notes: a.notes ?? "",
      photo_url: a.photo_url ?? "",
      program_id: a.program_id ?? "",
      program_start_date: a.program_start_date ?? "",
      class_period: (a as unknown as { class_period: string | null }).class_period ?? "",
      training_group: a.training_group ?? "",
      tags: (a.tags ?? []).join(", "),
    });
    setOpen(true);
  };

  // Deep-link support: /athletes?edit=<id> (used by the athlete profile
  // page's "Edit profile" button) opens straight into that athlete's dialog.
  // Waits for the roster to finish loading before looking the athlete up,
  // so a fast redirect-and-clear doesn't race the still-empty initial data.
  useEffect(() => {
    if (!editId || isLoading) return;
    const a = athletes.find((x) => x.id === editId);
    if (a) openEdit(a);
    void navigate({ to: "/athletes", search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, isLoading, athletes]);

  const exportCSV = () => downloadCSV("athletes.csv", filtered.map((a) => ({
    name: athleteDisplayName(a),
    team: teamMap.get(a.team_id ?? "")?.name ?? "",
    grade: a.grade ?? "", sport: a.sport ?? "",
    date_of_birth: (a as unknown as { date_of_birth: string | null }).date_of_birth ?? "",
    graduation_year: a.graduation_year ?? "",
    height_in: a.height_in ?? "", bodyweight_lb: a.bodyweight ?? "",
    athlete_email: a.athlete_email ?? "", parent_email: a.parent_email ?? "",
    status: a.status, notes: a.notes ?? "", created_at: a.created_at,
    training_group: a.training_group ?? "", tags: (a.tags ?? []).join("; "),
  })));

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Roster"
        title="Athletes"
        description={`${filtered.length} of ${athletes.length} athletes`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!eligibleForPinInvite.length) {
                  toast.info("No eligible athletes — need an email on file and not already active.");
                  return;
                }
                setPinInviteConfirmOpen(true);
              }}
              disabled={pinInvite.isPending || !eligibleForPinInvite.length}
              title="Send a magic-link email so athletes can set their 6-digit PIN"
            >
              <Send className="h-4 w-4" /> {pinInvite.isPending ? "Sending…" : `Send PIN emails (${eligibleForPinInvite.length})`}
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filtered.length}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button size="sm" onClick={openNew}><Plus className="h-4 w-4" /> Add athlete</Button>
          </>

        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Filters value={filters} onChange={setFilters} athletes={athletes} showDates={false} />
        <Select value={classPeriodFilter} onValueChange={setClassPeriodFilter}>
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue placeholder="Class period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All periods</SelectItem>
            <SelectItem value="__none">No period</SelectItem>
            {classPeriodOptions.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={trainingGroupFilter} onValueChange={setTrainingGroupFilter}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder="Training group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All training groups</SelectItem>
            <SelectItem value="__none">No training group</SelectItem>
            {trainingGroupOptions.map((g) => (
              <SelectItem key={g} value={g}>{g}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tagFilter} onValueChange={setTagFilter}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue placeholder="Tag" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tags</SelectItem>
            <SelectItem value="__none">No tags</SelectItem>
            {tagOptions.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered.length > 0 && (
          <Button size="sm" variant="ghost" onClick={toggleSelectAllFiltered} className="h-8">
            <CheckSquare className="h-4 w-4" />
            {allSelected ? "Clear selection" : `Select ${filtered.length}`}
          </Button>
        )}
        {selected.size > 0 && (
          <>
            <Badge variant="secondary">{selected.size} selected</Badge>
            <Button size="sm" onClick={() => setBulkOpen(true)}>Bulk edit</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </>
        )}
      </div>

      {activeTeamId && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm">
          <Filter className="h-4 w-4 shrink-0 text-primary" />
          <span>
            Showing only <span className="font-semibold">{teams.find((t) => t.id === activeTeamId)?.name ?? "one team"}</span> — the
            team filter at the top of the page is hiding everyone else, not just this roster.
          </span>
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => setActiveTeamId(null)}>
            Show all teams
          </Button>
        </div>
      )}

      <DuplicateAthletesBanner groups={dupGroups} dismiss={dismissDup} />

      {isLoading ? (
        <PageSkeleton variant="table" rows={8} className="!mb-0" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={athletes.length === 0 ? "No athletes yet" : "No athletes match these filters"}
          description={
            athletes.length === 0
              ? "Add your first athlete or share a team QR code from the Teams page to start rostering."
              : "Try clearing filters or search to see more athletes."
          }
          action={
            athletes.length === 0 ? (
              <Button size="sm" onClick={openNew}><Plus className="h-4 w-4" /> Add athlete</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox checked={allSelected} onCheckedChange={toggleSelectAllFiltered} aria-label="Select all" />
                </TableHead>
                <TableHead>Athlete</TableHead>
                <TableHead>Gender</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Training group</TableHead>
                <TableHead>Active program</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="w-[132px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => {
                const inviteStatus = (a as unknown as { invite_status?: string }).invite_status ?? "not_invited";
                return (
                  <TableRow
                    key={a.id}
                    data-state={selected.has(a.id) ? "selected" : undefined}
                    draggable={canAssignProgram}
                    onDragStart={(e) => {
                      if (!canAssignProgram) return;
                      e.dataTransfer.setData("application/x-athlete-id", a.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <TableCell>
                      <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggleSelected(a.id)} aria-label="Select athlete" />
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <Link to="/athletes/$id" params={{ id: a.id }} className="flex items-center gap-2">
                        <RosterAvatar name={athleteDisplayName(a)} photoUrl={a.photo_url} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium hover:underline">{athleteDisplayName(a)}</div>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {a.sport && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{a.sport}</Badge>}
                            {a.grade && <Badge variant="outline" className="h-4 px-1 text-[10px]">Gr {a.grade}</Badge>}
                            {a.status !== "active" && (
                              <Badge variant={a.status === "injured" ? "destructive" : "secondary"} className="h-4 px-1 text-[10px]">{a.status}</Badge>
                            )}
                            {duplicateIds.has(a.id) && (
                              <Badge variant="outline" className="h-4 border-amber-500/50 px-1 text-[10px] text-amber-500">Duplicate</Badge>
                            )}
                            {(inviteStatus === "sent" || inviteStatus === "delivered" || inviteStatus === "opened") && (
                              <Mail className="h-3 w-3 text-primary" aria-label="Invite sent" />
                            )}
                            {(inviteStatus === "failed" || inviteStatus === "expired") && (
                              <Mail className="h-3 w-3 text-destructive" aria-label={`Invite ${inviteStatus}`} />
                            )}
                          </div>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{genderLabel(a.gender)}</TableCell>
                    <TableCell className="text-xs">
                      {teamMap.get(a.team_id ?? "")?.name ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">{a.position ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      {a.training_group ? <Badge variant="outline" className="text-[11px]">{a.training_group}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {canAssignProgram ? (
                        <Select
                          value={a.program_id ?? "__none"}
                          onValueChange={async (v) => {
                            const newId = v === "__none" ? null : v;
                            const today = new Date().toISOString().slice(0, 10);
                            const { error } = await supabase.from("athletes")
                              .update({ program_id: newId, program_start_date: newId ? today : null })
                              .eq("id", a.id);
                            if (error) { toast.error(toUserMessage(error)); return; }
                            qc.invalidateQueries({ queryKey: ["athletes"] });
                            toast.success(newId ? "Program assigned" : "Program cleared");
                          }}
                        >
                          <SelectTrigger className="h-7 w-[160px] text-xs"><SelectValue placeholder="— none —" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">— none —</SelectItem>
                            {programs.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs">{programs.find((p) => p.id === a.program_id)?.name ?? <span className="text-muted-foreground">—</span>}</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[180px]">
                      <div className="flex flex-wrap gap-1">
                        {(a.tags ?? []).length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                        {(a.tags ?? []).map((t) => (
                          <Badge key={t} variant="secondary" className="h-4 px-1.5 text-[10px]">{t}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        <Link to="/athletes/$id" params={{ id: a.id }}>
                          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Open card"><ExternalLink className="h-3.5 w-3.5" /></Button>
                        </Link>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(a)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                        {(a.athlete_email ?? "").trim() && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setResetPinTarget(a)}
                            disabled={pinInvite.isPending}
                            aria-label="Reset PIN"
                            title="Reset PIN and send a new setup email"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setRemoveTarget(a)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit athlete" : "Add athlete"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First name *</Label>
                <Input
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                  onBlur={(e) => setForm((f) => ({ ...f, first_name: titleCaseName(e.target.value.trim()) }))}
                />
              </div>
              <div>
                <Label>Last name *</Label>
                <Input
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                  onBlur={(e) => setForm((f) => ({ ...f, last_name: titleCaseName(e.target.value.trim()) }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Team</Label>
                <Select value={form.team_id} onValueChange={(v) => setForm({ ...form, team_id: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="injured">Injured</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Grade</Label>
                <Select
                  value={form.grade}
                  onValueChange={(v) => {
                    const gy = gradeToGradYear(Number(v));
                    setForm({ ...form, grade: v, graduation_year: gy ? String(gy) : form.graduation_year });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{GRADES.map((g) => <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Grad. year</Label>
                <Input
                  inputMode="numeric"
                  value={form.graduation_year}
                  onChange={(e) => {
                    const yr = e.target.value;
                    const g = gradYearToGrade(Number(yr));
                    setForm({ ...form, graduation_year: yr, grade: g ? String(g) : form.grade });
                  }}
                  placeholder={`e.g. ${gradeToGradYear(9) ?? 2030}`}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(["fall", "winter", "spring"] as const).map((season) => {
                const key = `sport_${season}` as const;
                return (
                  <div key={season}>
                    <Label className="capitalize">{season} sport</Label>
                    <Select value={form[key]} onValueChange={(v) => setForm({ ...form, [key]: v === "__none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">—</SelectItem>
                        {SPORTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date of birth</Label><Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} /></div>
              <div>
                <Label>Gender</Label>
                <Select value={form.gender || "__none"} onValueChange={(v) => setForm({ ...form, gender: v === "__none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {GENDERS.map((g) => <SelectItem key={g} value={g}>{GENDER_LABELS[g]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {canAssignProgram && (
              <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3">
                <div>
                  <Label>Assigned program</Label>
                  <Select value={form.program_id || "__none"} onValueChange={(v) => setForm({ ...form, program_id: v === "__none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— none —</SelectItem>
                      {programs.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Program start</Label>
                  <Input type="date" value={form.program_start_date} onChange={(e) => setForm({ ...form, program_start_date: e.target.value })} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Height ({prefs.distance})</Label><Input inputMode="decimal" value={form.height_in} onChange={(e) => setForm({ ...form, height_in: e.target.value })} /></div>
              <div><Label>Bodyweight ({prefs.weight})</Label><Input inputMode="decimal" value={form.bodyweight} onChange={(e) => setForm({ ...form, bodyweight: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Athlete email</Label><Input type="email" value={form.athlete_email} onChange={(e) => setForm({ ...form, athlete_email: e.target.value })} /></div>
              <div><Label>Parent email</Label><Input type="email" value={form.parent_email} onChange={(e) => setForm({ ...form, parent_email: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Class period</Label><Input value={form.class_period} onChange={(e) => setForm({ ...form, class_period: e.target.value })} placeholder="e.g. 3rd, A Block" /></div>
              <div><Label>Photo URL</Label><Input value={form.photo_url} onChange={(e) => setForm({ ...form, photo_url: e.target.value })} placeholder="https://…" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Training group</Label><Input value={form.training_group} onChange={(e) => setForm({ ...form, training_group: e.target.value })} placeholder="e.g. LAFB | Offense" /></div>
              <div><Label>Tags</Label><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Comma-separated, e.g. Captain, Injury watch" /></div>
            </div>
            <div><Label>Notes</Label><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Injuries, goals, etc." /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{editing ? "Save changes" : "Add athlete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Bulk edit {selected.size} athlete{selected.size === 1 ? "" : "s"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Leave "Keep current" to leave a field unchanged.</p>
            <div>
              <Label>Team</Label>
              <Select value={bulkForm.team_id} onValueChange={(v) => setBulkForm({ ...bulkForm, team_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__keep">Keep current</SelectItem>
                  <SelectItem value="__none">No team</SelectItem>
                  {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={bulkForm.status} onValueChange={(v) => setBulkForm({ ...bulkForm, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__keep">Keep current</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="injured">Injured</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Grade</Label>
                <Select value={bulkForm.grade} onValueChange={(v) => setBulkForm({ ...bulkForm, grade: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__keep">Keep current</SelectItem>
                    <SelectItem value="__none">Clear</SelectItem>
                    {[6, 7, 8, 9, 10, 11, 12].map((g) => <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Sport</Label>
                <Input
                  value={bulkForm.sport === "__keep" ? "" : bulkForm.sport === "__none" ? "" : bulkForm.sport}
                  placeholder={bulkForm.sport === "__keep" ? "Keep current" : ""}
                  onChange={(e) => setBulkForm({ ...bulkForm, sport: e.target.value ? e.target.value : "__none" })}
                />
                <button type="button" className="mt-1 text-xs text-muted-foreground underline" onClick={() => setBulkForm({ ...bulkForm, sport: "__keep" })}>Reset to keep current</button>
              </div>
            </div>
            <div>
              <Label>Gender</Label>
              <Select value={bulkForm.gender} onValueChange={(v) => setBulkForm({ ...bulkForm, gender: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__keep">Keep current</SelectItem>
                  <SelectItem value="__none">Clear</SelectItem>
                  {GENDERS.map((g) => <SelectItem key={g} value={g}>{GENDER_LABELS[g]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Class period</Label>
              <Input
                value={bulkForm.class_period === "__keep" ? "" : bulkForm.class_period}
                placeholder={bulkForm.class_period === "__keep" ? "Keep current" : "e.g. 3rd, A Block (blank = clear)"}
                onChange={(e) => setBulkForm({ ...bulkForm, class_period: e.target.value })}
                onFocus={() => { if (bulkForm.class_period === "__keep") setBulkForm({ ...bulkForm, class_period: "" }); }}
              />
              <button type="button" className="mt-1 text-xs text-muted-foreground underline" onClick={() => setBulkForm({ ...bulkForm, class_period: "__keep" })}>Reset to keep current</button>
            </div>
            <div>
              <Label>Training group</Label>
              <Input
                value={bulkForm.training_group === "__keep" ? "" : bulkForm.training_group}
                placeholder={bulkForm.training_group === "__keep" ? "Keep current" : "e.g. LAFB | Offense (blank = clear)"}
                onChange={(e) => setBulkForm({ ...bulkForm, training_group: e.target.value })}
                onFocus={() => { if (bulkForm.training_group === "__keep") setBulkForm({ ...bulkForm, training_group: "" }); }}
              />
              <button type="button" className="mt-1 text-xs text-muted-foreground underline" onClick={() => setBulkForm({ ...bulkForm, training_group: "__keep" })}>Reset to keep current</button>
            </div>
            <div>
              <Label>Program</Label>
              <Select value={bulkForm.program_id} onValueChange={(v) => setBulkForm({ ...bulkForm, program_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__keep">Keep current</SelectItem>
                  <SelectItem value="__none">Unassign program</SelectItem>
                  {programs.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button onClick={() => bulkEdit.mutate()} disabled={bulkEdit.isPending}>
              {bulkEdit.isPending ? "Saving…" : `Apply to ${selected.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={pinInviteConfirmOpen}
        onOpenChange={setPinInviteConfirmOpen}
        title="Send PIN setup emails?"
        description={`This sends a magic-link email to ${eligibleForPinInvite.length} athlete${eligibleForPinInvite.length === 1 ? "" : "s"} so they can set their 6-digit sign-in PIN.`}
        confirmLabel="Send"
        onConfirm={() => { pinInvite.mutate({ ids: eligibleForPinInvite.map((a) => a.id) }); setPinInviteConfirmOpen(false); }}
        pending={pinInvite.isPending}
      />

      <ConfirmDeleteDialog
        open={!!resetPinTarget}
        onOpenChange={(o) => !o && setResetPinTarget(null)}
        title="Reset PIN?"
        description={resetPinTarget ? `This resets ${athleteDisplayName(resetPinTarget)}'s PIN and sends a new setup email. Their old PIN will stop working.` : ""}
        confirmLabel="Reset & send"
        onConfirm={() => { if (resetPinTarget) pinInvite.mutate({ ids: [resetPinTarget.id], mode: "reset" }); setResetPinTarget(null); }}
        pending={pinInvite.isPending}
      />

      <ConfirmDeleteDialog
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        title={`Remove ${removeTarget ? athleteDisplayName(removeTarget) : ""}?`}
        description="This permanently deletes the athlete along with all their tests, lifts, and attendance records. This can't be undone."
        onConfirm={() => { if (removeTarget) del.mutate(removeTarget.id); setRemoveTarget(null); }}
        pending={del.isPending}
      />
    </div>
  );
}
