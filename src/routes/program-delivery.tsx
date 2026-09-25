import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  athletesQO,
  athleteTeamsQO,
  teamsQO,
  programsQO,
  programPhasesQO,
  programSessionsQO,
  repMaxesQO,
  type WorkoutExercise,
  type WorkoutSet,
} from "@/lib/queries";
import {
  rosterForTeam,
  sessionWorkoutContentQO,
  rackGroupsQO,
  resolveRackGroups,
  groupExercisesBySuperset,
  blockLabel,
  setsForExercise,
  formatPrescription,
} from "@/lib/program-delivery";
import {
  buildPrintCardsPdf,
  buildAthleteCardsPdf,
  buildRackSheetsPdf,
  pdfPreviewUrl,
  downloadPdf,
  type SessionInfo,
} from "@/lib/program-delivery-export";
import { usePermission } from "@/hooks/use-permissions";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Printer,
  MonitorPlay,
  Users,
  Grid3x3,
  RefreshCw,
  Download,
  Maximize2,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/program-delivery")({
  head: () => ({ meta: [{ title: "Program Delivery — Strength Lab" }] }),
  component: ProgramDeliveryPage,
});

type Tab = "print" | "present" | "athlete" | "rack";

function ProgramDeliveryPage() {
  const { allowed: canExport } = usePermission("workouts.view");
  const [activeTeamId] = useActiveTeamId();

  const { data: teams = [] } = useQuery(teamsQO);
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: athleteTeams = [] } = useQuery(athleteTeamsQO);
  const { data: programs = [] } = useQuery(programsQO);
  const { data: repMaxes = [] } = useQuery(repMaxesQO);

  const [teamId, setTeamId] = useState<string>(activeTeamId ?? "");
  const [programId, setProgramId] = useState<string>("");
  const [phaseId, setPhaseId] = useState<string>("");
  const [week, setWeek] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [tab, setTab] = useState<Tab>("print");

  // Programs aren't required to belong to a team, and a coach may want a
  // program authored under a different team than the roster they're
  // printing for — so the picker lists every program, not just ones
  // scoped to the currently selected team.
  const sortedPrograms = useMemo(
    () => programs.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [programs],
  );
  const teamNameById = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);
  const { data: phases = [] } = useQuery(programPhasesQO(programId));
  const { data: sessions = [] } = useQuery(programSessionsQO(programId));

  // Once a program is picked, jump straight to a session instead of making
  // the coach also filter phase/week/session by hand: prefer today's
  // scheduled session, then the next upcoming one, then the most recent
  // past one, then just the first session in the program.
  useEffect(() => {
    if (!programId || sessionId || sessions.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const dated = sessions.filter((s) => s.scheduled_date);
    const pick =
      dated.find((s) => s.scheduled_date === today) ??
      dated
        .filter((s) => s.scheduled_date! >= today)
        .sort((a, b) => a.scheduled_date!.localeCompare(b.scheduled_date!))[0] ??
      dated.slice().sort((a, b) => b.scheduled_date!.localeCompare(a.scheduled_date!))[0] ??
      sessions
        .slice()
        .sort((a, b) => a.week - b.week || a.day - b.day || a.position - b.position)[0];
    if (!pick) return;
    setPhaseId(pick.phase_id);
    setWeek(String(pick.week));
    setSessionId(pick.id);
  }, [programId, sessionId, sessions]);

  const phaseSessions = useMemo(
    () => sessions.filter((s) => s.phase_id === phaseId),
    [sessions, phaseId],
  );
  const weeks = useMemo(
    () => Array.from(new Set(phaseSessions.map((s) => s.week))).sort((a, b) => a - b),
    [phaseSessions],
  );
  const weekSessions = useMemo(
    () =>
      phaseSessions
        .filter((s) => s.week === Number(week))
        .sort((a, b) => a.day - b.day || a.position - b.position),
    [phaseSessions, week],
  );

  const session = useMemo(
    () => weekSessions.find((s) => s.id === sessionId) ?? null,
    [weekSessions, sessionId],
  );
  const team = useMemo(() => teams.find((t) => t.id === teamId) ?? null, [teams, teamId]);
  const program = useMemo(
    () => programs.find((p) => p.id === programId) ?? null,
    [programs, programId],
  );
  const phase = useMemo(() => phases.find((p) => p.id === phaseId) ?? null, [phases, phaseId]);

  const { data: content } = useQuery(sessionWorkoutContentQO(session?.workout_id ?? null));
  const roster = useMemo(
    () => rosterForTeam(athletes, athleteTeams, teamId || null),
    [athletes, athleteTeams, teamId],
  );
  const { data: rackPersisted = [] } = useQuery(
    rackGroupsQO(teamId || null, session?.scheduled_date ?? null),
  );
  const { groups: rackGroups, isAutoGrouped } = useMemo(
    () => resolveRackGroups(roster, rackPersisted),
    [roster, rackPersisted],
  );

  const sessionInfo: SessionInfo = {
    teamName: team?.name ?? "—",
    programName: program?.name ?? "—",
    phaseName: phase?.name ?? "—",
    weekLabel: week ? `Week ${week}` : "—",
    sessionName: session?.name ?? "Session",
    scheduledDate: session?.scheduled_date ?? null,
  };

  const exercises = useMemo(() => content?.exercises ?? [], [content]);
  const sets = useMemo(() => content?.sets ?? [], [content]);
  const ready = !!session;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);

  const buildActivePdf = () => {
    if (tab === "present") return null;
    if (tab === "print")
      return buildPrintCardsPdf({
        session: sessionInfo,
        exercises,
        sets,
        coachNotes: session?.notes,
      });
    if (tab === "athlete")
      return buildAthleteCardsPdf({ session: sessionInfo, roster, exercises, sets, repMaxes });
    return buildRackSheetsPdf({
      session: sessionInfo,
      rackGroups,
      isAutoGrouped,
      exercises,
      sets,
      repMaxes,
    });
  };

  const rebuildPreview = () => {
    setBuilding(true);
    try {
      const doc = buildActivePdf();
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return doc ? pdfPreviewUrl(doc) : null;
      });
    } finally {
      setBuilding(false);
    }
  };

  useEffect(() => {
    if (!ready) {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    rebuildPreview();
    // Rebuilds when the selected session/tab changes or the underlying data
    // set actually grows/shrinks; edits to existing rows need the explicit
    // "Rebuild preview" button (matches the delivery screen's intended UX).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    tab,
    session?.id,
    exercises.length,
    sets.length,
    roster.length,
    rackGroups.length,
    repMaxes.length,
  ]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const printPreview = () => {
    const win = previewFrameRef.current?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  };

  const download = () => {
    const doc = buildActivePdf();
    if (!doc) return;
    const base =
      `${sessionInfo.teamName} - ${sessionInfo.sessionName} - ${sessionInfo.weekLabel}`.replace(
        /[^\w\- ]/g,
        "",
      );
    const suffix = tab === "athlete" ? "athlete-cards" : tab === "rack" ? "rack-sheets" : "handout";
    downloadPdf(doc, `${base} (${suffix}).pdf`);
  };

  const downloadLabel =
    tab === "rack"
      ? `Download ${rackGroups.length} rack sheet${rackGroups.length === 1 ? "" : "s"} (PDF)`
      : tab === "athlete"
        ? `Download ${roster.length} athlete card${roster.length === 1 ? "" : "s"} (PDF)`
        : "Download handout (PDF)";

  return (
    <div>
      <PageHeader
        title="Program Delivery"
        description="Print or present a session's content — a generic handout, a presentation view, individual athlete cards, and rack sheets with each athlete's own working weight."
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-5">
          <FilterField label="Training Group">
            <Select
              value={teamId}
              onValueChange={(v) => {
                setTeamId(v);
                setProgramId("");
                setPhaseId("");
                setWeek("");
                setSessionId("");
              }}
            >
              <SelectTrigger className="h-9 w-[180px]">
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
          </FilterField>
          <FilterField label="Program">
            <Select
              value={programId}
              onValueChange={(v) => {
                setProgramId(v);
                setPhaseId("");
                setWeek("");
                setSessionId("");
                // A program's own team, if it has one, is the natural roster
                // for athlete cards/rack sheets — pick it up automatically
                // instead of making the coach also set Training Group.
                const picked = programs.find((p) => p.id === v);
                if (picked?.team_id && picked.team_id !== teamId) setTeamId(picked.team_id);
              }}
            >
              <SelectTrigger className="h-9 w-[220px]">
                <SelectValue placeholder="Select program" />
              </SelectTrigger>
              <SelectContent>
                {sortedPrograms.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.team_id ? ` (${teamNameById.get(p.team_id) ?? "team"})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Phase">
            <Select
              value={phaseId}
              onValueChange={(v) => {
                setPhaseId(v);
                setWeek("");
                setSessionId("");
              }}
              disabled={!programId}
            >
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue placeholder="Select phase" />
              </SelectTrigger>
              <SelectContent>
                {phases.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Week">
            <Select
              value={week}
              onValueChange={(v) => {
                setWeek(v);
                setSessionId("");
              }}
              disabled={!phaseId}
            >
              <SelectTrigger className="h-9 w-[110px]">
                <SelectValue placeholder="Week" />
              </SelectTrigger>
              <SelectContent>
                {weeks.map((w) => (
                  <SelectItem key={w} value={String(w)}>{`Week ${w}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Session">
            <Select value={sessionId} onValueChange={setSessionId} disabled={!week}>
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue placeholder="Select session" />
              </SelectTrigger>
              <SelectContent>
                {weekSessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
        </CardContent>
      </Card>

      {!ready ? (
        <EmptyState
          icon={Printer}
          title="Pick a training group, program, and session"
          description="Once a session is selected, its handout, presentation, athlete cards, and rack sheets build here."
        />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="print">
                <Printer className="mr-1.5 h-3.5 w-3.5" />
                Print cards
              </TabsTrigger>
              <TabsTrigger value="present">
                <MonitorPlay className="mr-1.5 h-3.5 w-3.5" />
                Presentation
              </TabsTrigger>
              <TabsTrigger value="athlete">
                <Users className="mr-1.5 h-3.5 w-3.5" />
                Athlete cards
              </TabsTrigger>
              <TabsTrigger value="rack">
                <Grid3x3 className="mr-1.5 h-3.5 w-3.5" />
                Rack sheets
              </TabsTrigger>
            </TabsList>
            {tab !== "present" && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={rebuildPreview} disabled={building}>
                  <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", building && "animate-spin")} />{" "}
                  Rebuild preview
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={printPreview}
                  disabled={!canExport || !previewUrl}
                >
                  <Printer className="mr-1.5 h-3.5 w-3.5" /> Print
                </Button>
                <Button size="sm" onClick={download} disabled={!canExport}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> {downloadLabel}
                </Button>
              </div>
            )}
          </div>

          {tab === "rack" && isAutoGrouped && (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <Info className="h-3.5 w-3.5 shrink-0" />
              No rack assignment is on file for {sessionInfo.scheduledDate ?? "this session"} —
              showing the roster auto-grouped into racks of 4 (alphabetical). Assign real racks in
              Training View to override this.
            </div>
          )}

          <TabsContent value="print">
            <PdfPreview url={previewUrl} frameRef={previewFrameRef} />
          </TabsContent>
          <TabsContent value="athlete">
            <PdfPreview url={previewUrl} frameRef={previewFrameRef} />
          </TabsContent>
          <TabsContent value="rack">
            <PdfPreview url={previewUrl} frameRef={previewFrameRef} />
          </TabsContent>
          <TabsContent value="present">
            <PresentationView session={sessionInfo} exercises={exercises} sets={sets} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function PdfPreview({
  url,
  frameRef,
}: {
  url: string | null;
  frameRef: React.RefObject<HTMLIFrameElement | null>;
}) {
  if (!url) {
    return (
      <EmptyState
        icon={Printer}
        title="Nothing to preview yet"
        description="This session has no exercises, or the roster is empty."
      />
    );
  }
  return (
    <div
      className="overflow-hidden rounded-lg border border-border/60 bg-muted/20"
      style={{ height: "75vh" }}
    >
      <iframe ref={frameRef} src={url} title="Program delivery preview" className="h-full w-full" />
    </div>
  );
}

function sessionSubtitleText(s: SessionInfo) {
  return [s.teamName, s.programName, s.phaseName, s.weekLabel].filter(Boolean).join(" · ");
}

function PresentationView({
  session,
  exercises,
  sets,
}: {
  session: SessionInfo;
  exercises: WorkoutExercise[];
  sets: WorkoutSet[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const blocks = groupExercisesBySuperset(exercises);

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => ref.current?.requestFullscreen?.()}>
          <Maximize2 className="mr-1.5 h-3.5 w-3.5" /> Present
        </Button>
      </div>
      <div
        ref={ref}
        className={cn(
          "space-y-6 overflow-y-auto rounded-lg border border-border/60 bg-background p-8",
          isFullscreen && "h-screen",
        )}
        style={{ minHeight: "70vh" }}
      >
        <div>
          <div className="text-sm uppercase tracking-widest text-muted-foreground">
            {sessionSubtitleText(session)}
          </div>
          <h2 className="font-display text-4xl tracking-tight">{session.sessionName}</h2>
        </div>
        {blocks.length === 0 && (
          <p className="text-muted-foreground">No exercises in this session yet.</p>
        )}
        {blocks.map((block, blockIdx) => (
          <div
            key={block.items[0]?.id ?? blockIdx}
            className="rounded-xl border border-border/50 p-6"
          >
            <div className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">
              {blockLabel(block, blockIdx)}
            </div>
            <div className="space-y-4">
              {block.items.map((ex) => (
                <div key={ex.id} className="flex items-baseline justify-between gap-4">
                  <span className="text-2xl font-semibold">{ex.exercise_name}</span>
                  <span className="text-lg text-muted-foreground">
                    {setsForExercise(sets, ex.id)
                      .map((s) => formatPrescription(ex, s))
                      .join(" / ") || "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
