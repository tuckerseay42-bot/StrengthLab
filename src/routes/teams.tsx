import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveOrgId } from "@/hooks/use-active-org";
import {
  teamsQO,
  athletesQO,
  registrationsQO,
  athleteTeamsQO,
  programsQO,
  athleteDisplayName,
  type Team,
  type Registration,
  type Athlete,
  type Program,
} from "@/lib/queries";
import { SPORTS } from "@/lib/domain";
import { findDuplicateAthlete } from "@/lib/validation";
import { rosterForTeam } from "@/lib/program-delivery";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Plus, QrCode, RefreshCw, Archive, Check, X, Copy, Layers } from "lucide-react";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";

export const Route = createFileRoute("/teams")({
  head: () => ({ meta: [{ title: "Teams — Strength Lab" }] }),
  component: TeamsPage,
});

function TeamsPage() {
  const qc = useQueryClient();
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: registrations = [] } = useQuery(registrationsQO);
  const { data: athleteTeams = [] } = useQuery(athleteTeamsQO);
  const { data: programs = [] } = useQuery(programsQO);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [form, setForm] = useState({
    name: "",
    sport: "",
    season: "",
    color: "#F97316",
    notes: "",
  });
  const [qrTeam, setQrTeam] = useState<Team | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Team | null>(null);
  const [assignTeam, setAssignTeam] = useState<Team | null>(null);
  const [assignProgramId, setAssignProgramId] = useState<string>("__none");
  const [activeOrgId] = useActiveOrgId();
  const visibleTeams = useMemo(() => {
    if (!activeOrgId) return teams;
    return teams.filter((t) => t.organization_id === activeOrgId);
  }, [teams, activeOrgId]);
  const visibleTeamIds = useMemo(() => new Set(visibleTeams.map((t) => t.id)), [visibleTeams]);

  const rosterCounts = useMemo(() => {
    const m = new Map<string, number>();
    // Count unique (team, athlete) pairs across both the primary team_id and athlete_teams memberships.
    const seen = new Set<string>();
    const bump = (teamId: string, athleteId: string) => {
      const key = `${teamId}:${athleteId}`;
      if (seen.has(key)) return;
      seen.add(key);
      m.set(teamId, (m.get(teamId) ?? 0) + 1);
    };
    athletes.forEach((a) => {
      if (a.team_id) bump(a.team_id, a.id);
    });
    athleteTeams.forEach((r) => {
      if (r.team_id && r.athlete_id) bump(r.team_id, r.athlete_id);
    });
    return m;
  }, [athletes, athleteTeams]);

  const pendingCounts = useMemo(() => {
    const m = new Map<string, number>();
    registrations
      .filter((r) => r.status === "pending")
      .forEach((r) => m.set(r.team_id, (m.get(r.team_id) ?? 0) + 1));
    return m;
  }, [registrations]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Team name is required");
      const payload = {
        name: form.name.trim(),
        sport: form.sport || null,
        season: form.season.trim() || null,
        color: form.color || null,
        notes: form.notes.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("teams").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("teams").insert({
          ...payload,
          ...(activeOrgId ? { organization_id: activeOrgId } : {}),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      toast.success(editing ? "Team updated" : "Team created");
      setOpen(false);
      setEditing(null);
      setForm({ name: "", sport: "", season: "", color: "#F97316", notes: "" });
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const regen = useMutation({
    mutationFn: async (t: Team) => {
      const uuid = crypto.randomUUID();
      const { error } = await supabase.from("teams").update({ qr_token: uuid }).eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      toast.success("QR link regenerated");
    },
  });

  const archive = useMutation({
    mutationFn: async (t: Team) => {
      const { error } = await supabase
        .from("teams")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      toast.success("Team archived");
    },
  });

  const assignProgram = useMutation({
    mutationFn: async () => {
      if (!assignTeam) throw new Error("No team selected");
      const roster = rosterForTeam(athletes, athleteTeams, assignTeam.id);
      if (!roster.length) throw new Error("This team has no athletes yet");
      const programId = assignProgramId === "__none" ? null : assignProgramId;
      const payload = {
        program_id: programId,
        program_start_date: programId ? new Date().toISOString().slice(0, 10) : null,
      };
      const { error } = await supabase
        .from("athletes")
        .update(payload)
        .in(
          "id",
          roster.map((a) => a.id),
        );
      if (error) throw error;
      return roster.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["athletes"] });
      toast.success(`Assigned program to ${n} athlete${n === 1 ? "" : "s"}`);
      setAssignTeam(null);
      setAssignProgramId("__none");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Teams</h1>
          <p className="text-sm text-muted-foreground">
            {visibleTeams.length} active team{visibleTeams.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setForm({ name: "", sport: "", season: "", color: "#F97316", notes: "" });
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> New team
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {visibleTeams.map((t) => {
          const pending = pendingCounts.get(t.id) ?? 0;
          return (
            <Card key={t.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ background: t.color ?? "#F97316" }}
                    />
                    <CardTitle className="text-base">{t.name}</CardTitle>
                  </div>
                  {pending > 0 && <Badge variant="destructive">{pending} pending</Badge>}
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {t.sport && <Badge variant="secondary">{t.sport}</Badge>}
                  {t.season && <Badge variant="outline">{t.season}</Badge>}
                  <Badge variant="outline">{rosterCounts.get(t.id) ?? 0} athletes</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 pt-0">
                <Button size="sm" variant="outline" onClick={() => setQrTeam(t)}>
                  <QrCode className="h-4 w-4" /> QR / Invite
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAssignTeam(t);
                    setAssignProgramId("__none");
                  }}
                >
                  <Layers className="h-4 w-4" /> Assign Program
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(t);
                    setForm({
                      name: t.name,
                      sport: t.sport ?? "",
                      season: t.season ?? "",
                      color: t.color ?? "#F97316",
                      notes: t.notes ?? "",
                    });
                    setOpen(true);
                  }}
                >
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setArchiveTarget(t)}>
                  <Archive className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <PendingInbox
        registrations={registrations.filter((r) => visibleTeamIds.has(r.team_id))}
        teams={visibleTeams}
        athletes={athletes}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit team" : "New team"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Varsity Football"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Sport</Label>
                <Select value={form.sport} onValueChange={(v) => setForm({ ...form, sport: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {SPORTS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Season</Label>
                <Input
                  value={form.season}
                  onChange={(e) => setForm({ ...form, season: e.target.value })}
                  placeholder="2026 Fall"
                />
              </div>
            </div>
            <div className="grid grid-cols-[80px_1fr] gap-3">
              <div>
                <Label>Color</Label>
                <Input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                />
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
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qrTeam} onOpenChange={(o) => !o && setQrTeam(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{qrTeam?.name} — Registration QR</DialogTitle>
          </DialogHeader>
          {qrTeam && <QRPanel team={qrTeam} onRegen={() => regen.mutate(qrTeam)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!assignTeam} onOpenChange={(o) => !o && setAssignTeam(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign program — {assignTeam?.name}</DialogTitle>
          </DialogHeader>
          {assignTeam && (
            <AssignProgramPanel
              team={assignTeam}
              programs={programs}
              rosterCount={rosterForTeam(athletes, athleteTeams, assignTeam.id).length}
              value={assignProgramId}
              onChange={setAssignProgramId}
              onConfirm={() => assignProgram.mutate()}
              pending={assignProgram.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!archiveTarget}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        title={`Archive "${archiveTarget?.name}"?`}
        description="Archived teams are hidden from active rosters and selectors. Their data isn't deleted, but there's no self-service way to unarchive a team yet."
        confirmLabel="Archive"
        onConfirm={() => {
          if (archiveTarget) archive.mutate(archiveTarget);
          setArchiveTarget(null);
        }}
        pending={archive.isPending}
      />
    </div>
  );
}

function QRPanel({ team, onRegen }: { team: Team; onRegen: () => void }) {
  const { url, isPrivatePreview } = getInviteLink(team.qr_token);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Athletes scan this to join <span className="font-medium text-foreground">{team.name}</span>.
        Coach approves each registration before it becomes active.
      </p>
      {isPrivatePreview && (
        <div className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">
          This is a private preview link. Publish the app, then open Teams from the published app
          before sharing QR codes with athletes.
        </div>
      )}
      <div className="mx-auto grid w-fit place-items-center rounded-lg border bg-white p-4">
        <QRCodeSVG value={url} size={220} />
      </div>
      <div className="flex items-center gap-2">
        <Input readOnly value={url} className="font-mono text-xs" />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(url);
            toast.success("Copied");
          }}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex justify-between">
        <Button size="sm" variant="ghost" onClick={onRegen}>
          <RefreshCw className="h-4 w-4" /> Regenerate link
        </Button>
        <a className="text-sm underline" href={url} target="_blank" rel="noreferrer">
          Open form
        </a>
      </div>
    </div>
  );
}

function AssignProgramPanel({
  team,
  programs,
  rosterCount,
  value,
  onChange,
  onConfirm,
  pending,
}: {
  team: Team;
  programs: Program[];
  rosterCount: number;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const teamPrograms = programs.filter((p) => p.team_id === team.id);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Assigns every athlete currently on{" "}
        <span className="font-medium text-foreground">{team.name}</span> ({rosterCount} athlete
        {rosterCount === 1 ? "" : "s"}) to the selected program. To change one athlete's program
        later, edit that athlete under Athletes.
      </p>
      {teamPrograms.length === 0 ? (
        <p className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">
          No programs exist for this team yet — create one on the Programs page first.
        </p>
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select a program" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">No program (clear)</SelectItem>
            {teamPrograms.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <DialogFooter>
        <Button onClick={onConfirm} disabled={pending || !rosterCount || teamPrograms.length === 0}>
          {pending
            ? "Assigning…"
            : `Assign to ${rosterCount} athlete${rosterCount === 1 ? "" : "s"}`}
        </Button>
      </DialogFooter>
    </div>
  );
}

function getInviteLink(token: string) {
  if (typeof window === "undefined") return { url: `/join/${token}`, isPrivatePreview: false };
  const { hostname, origin } = window.location;
  return {
    url: `${origin}/join/${token}`,
    isPrivatePreview: isLovablePrivatePreview(hostname),
  };
}

function isLovablePrivatePreview(hostname: string) {
  return (
    /^id-preview--[a-f0-9-]+\.lovable\.app$/.test(hostname) ||
    /^[a-f0-9-]+\.lovableproject\.com$/.test(hostname)
  );
}

function PendingInbox({
  registrations,
  teams,
  athletes,
}: {
  registrations: Registration[];
  teams: Team[];
  athletes: Athlete[];
}) {
  const qc = useQueryClient();
  const pending = registrations.filter((r) => r.status === "pending");
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  // Approving used to insert with no duplicate check at all — if a coach had
  // already manually added this athlete (or approved them once already), the
  // second approval silently created a second, separate athlete row with its
  // own empty history. Athletes and data then look like they "disappeared"
  // because they're actually split across two records.
  const [dupConfirm, setDupConfirm] = useState<{
    registration: Registration;
    existing: Athlete;
  } | null>(null);

  const approve = useMutation({
    mutationFn: async (r: Registration) => {
      const team = teamMap.get(r.team_id);
      const displayName = `${r.first_name} ${r.last_name}`.trim();
      const sportFall = (r as never as { sport_fall: string | null }).sport_fall ?? null;
      const sportWinter = (r as never as { sport_winter: string | null }).sport_winter ?? null;
      const sportSpring = (r as never as { sport_spring: string | null }).sport_spring ?? null;
      const { data: inserted, error: aerr } = await supabase
        .from("athletes")
        .insert({
          name: displayName,
          first_name: r.first_name,
          last_name: r.last_name,
          preferred_name: r.preferred_name,
          student_id: r.student_id,
          grade: r.grade,
          sport: r.sport ?? team?.sport ?? null,
          sport_fall: sportFall,
          sport_winter: sportWinter,
          sport_spring: sportSpring,
          date_of_birth: (r as never as { date_of_birth: string | null }).date_of_birth ?? null,
          gender: (r as never as { gender: string | null }).gender ?? null,
          position: r.position,
          graduation_year: r.graduation_year,
          height_in: r.height_in,
          bodyweight: r.weight_lb,
          parent_email: r.parent_email,
          athlete_email: r.athlete_email,
          team_id: r.team_id,
          organization_id:
            (r as never as { organization_id: string | null }).organization_id ??
            team?.organization_id ??
            null,
          status: "active",
        } as never)
        .select("id, organization_id")
        .single();
      if (aerr) throw aerr;

      // Auto-enroll into every team in the same org whose sport matches a seasonal pick
      const orgId =
        (inserted as { organization_id: string | null } | null)?.organization_id ??
        team?.organization_id ??
        null;
      const athleteId = (inserted as { id: string } | null)?.id;
      if (athleteId && orgId) {
        const seasonPicks: Array<{ season: string; sport: string | null }> = [
          { season: "fall", sport: sportFall },
          { season: "winter", sport: sportWinter },
          { season: "spring", sport: sportSpring },
        ];
        const wanted = seasonPicks.filter((s) => s.sport && s.sport.trim().length > 0);

        const memberships = new Map<string, string | null>();
        // Always include the team they registered under
        memberships.set(r.team_id, null);

        if (wanted.length > 0) {
          const { data: matchTeams } = await supabase
            .from("teams")
            .select("id, sport")
            .eq("organization_id", orgId)
            .is("archived_at", null)
            .in(
              "sport",
              wanted.map((w) => w.sport as string),
            );
          for (const t of (matchTeams ?? []) as Array<{ id: string; sport: string | null }>) {
            const pick = wanted.find((w) => w.sport === t.sport);
            if (pick && !memberships.has(t.id)) memberships.set(t.id, pick.season);
          }
        }

        const rows = Array.from(memberships.entries()).map(([team_id, season]) => ({
          athlete_id: athleteId,
          team_id,
          season,
        }));
        if (rows.length > 0) {
          await supabase
            .from("athlete_teams")
            .upsert(rows as never, { onConflict: "athlete_id,team_id" });
        }
      }

      const { error: rerr } = await supabase
        .from("registrations")
        .update({ status: "approved", reviewed_at: new Date().toISOString() })
        .eq("id", r.id);
      if (rerr) throw rerr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["registrations"] });
      qc.invalidateQueries({ queryKey: ["athletes"] });
      toast.success("Athlete added to all matching teams");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const reject = useMutation({
    mutationFn: async (r: Registration) => {
      const { error } = await supabase
        .from("registrations")
        .update({ status: "rejected", reviewed_at: new Date().toISOString() })
        .eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["registrations"] });
      toast.info("Registration rejected");
    },
  });

  if (!pending.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pending registrations ({pending.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {pending.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
          >
            <div className="min-w-0">
              <div className="font-medium">
                {r.first_name} {r.last_name}
                {r.preferred_name ? ` (${r.preferred_name})` : ""}
              </div>
              <div className="text-xs text-muted-foreground">
                {teamMap.get(r.team_id)?.name ?? "—"} · Grade {r.grade ?? "—"} · Class of{" "}
                {r.graduation_year ?? "—"} · {r.weight_lb ?? "—"} lb
              </div>
              <div className="text-xs text-muted-foreground">
                Sports:{" "}
                {[
                  (r as never as { sport_fall?: string }).sport_fall &&
                    `Fall ${(r as never as { sport_fall: string }).sport_fall}`,
                  (r as never as { sport_winter?: string }).sport_winter &&
                    `Winter ${(r as never as { sport_winter: string }).sport_winter}`,
                  (r as never as { sport_spring?: string }).sport_spring &&
                    `Spring ${(r as never as { sport_spring: string }).sport_spring}`,
                ]
                  .filter(Boolean)
                  .join(" · ") ||
                  r.sport ||
                  "—"}
                {(r as never as { date_of_birth?: string }).date_of_birth
                  ? ` · DOB ${(r as never as { date_of_birth: string }).date_of_birth}`
                  : ""}
              </div>
              {(r.athlete_email || r.parent_email) && (
                <div className="text-xs text-muted-foreground">
                  {[r.athlete_email, r.parent_email].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={approve.isPending}
                onClick={() => {
                  const displayName = `${r.first_name} ${r.last_name}`.trim();
                  const dup = findDuplicateAthlete(athletes, displayName);
                  if (dup) setDupConfirm({ registration: r, existing: dup });
                  else approve.mutate(r);
                }}
              >
                <Check className="h-4 w-4" /> Approve
              </Button>
              <Button size="sm" variant="ghost" onClick={() => reject.mutate(r)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>

      <AlertDialog open={!!dupConfirm} onOpenChange={(v) => !v && setDupConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              An athlete named "{dupConfirm ? athleteDisplayName(dupConfirm.existing) : ""}" already
              exists
            </AlertDialogTitle>
            <AlertDialogDescription>
              Approving this registration creates a second, separate athlete record — none of the
              existing athlete's tests, lifts, or attendance carry over, and their sign-in stays
              linked to whichever record it was set up on. If this is the same person, reject this
              registration instead. Only continue if these are two different people who share a
              name.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (dupConfirm) approve.mutate(dupConfirm.registration);
                setDupConfirm(null);
              }}
              disabled={approve.isPending}
            >
              Create separate athlete anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
