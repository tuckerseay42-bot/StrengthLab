import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { athletesQO, attendanceQO, bodyweightLogsQO, athleteTeamsQO, teamsQO } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { Filters, emptyFilters, filterAthletes, inDateRange } from "@/components/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Check, X, Users, Copy, QrCode, Radio } from "lucide-react";
import { downloadCSV } from "@/lib/domain";
import { toast } from "sonner";
import { publicOrigin } from "@/lib/share-url";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import { cn } from "@/lib/utils";


export const Route = createFileRoute("/attendance")({
  head: () => ({ meta: [{ title: "Attendance — Strength Lab" }] }),
  component: AttendancePage,
});

function AttendancePage() {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: attendance = [] } = useQuery(attendanceQO);
  const { data: bodyweightLogs = [] } = useQuery(bodyweightLogsQO);
  const { data: athleteTeams = [] } = useQuery(athleteTeamsQO);
  const [activeTeamId] = useActiveTeamId();
  const [filters, setFilters] = useState(emptyFilters);
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().slice(0, 10));
  const { data: teams = [] } = useQuery(teamsQO);
  const [qrTeamId, setQrTeamId] = useState<string>("");
  const [showQr, setShowQr] = useState(false);
  const [view, setView] = useState<"list" | "board">("list");
  const qrTeam = useMemo(
    () => teams.find((t) => t.id === qrTeamId) ?? teams.find((t) => t.id === activeTeamId) ?? teams[0],
    [teams, qrTeamId, activeTeamId],
  );
  const rosterUrl = qrTeam ? `${publicOrigin()}/checkin/${qrTeam.qr_token}` : "";


  const teamsByAthlete = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of athleteTeams) {
      const s = m.get(r.athlete_id) ?? new Set<string>();
      s.add(r.team_id);
      m.set(r.athlete_id, s);
    }
    return m;
  }, [athleteTeams]);
  const byId = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes]);
  const roster = useMemo(
    () => filterAthletes(athletes, filters, activeTeamId, teamsByAthlete),
    [athletes, filters, activeTeamId, teamsByAthlete],
  );
  const rosterIds = useMemo(() => new Set(roster.map((a) => a.id)), [roster]);

  const todayMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const r of attendance) if (r.session_date === sessionDate) m.set(r.athlete_id, r.present);
    return m;
  }, [attendance, sessionDate]);

  const bwByAthleteDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of bodyweightLogs) m.set(`${r.athlete_id}:${r.log_date}`, r.value);
    return m;
  }, [bodyweightLogs]);
  const todayBwMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of bodyweightLogs) if (r.log_date === sessionDate) m.set(r.athlete_id, r.value);
    return m;
  }, [bodyweightLogs, sessionDate]);

  // --- Live check-in feed -------------------------------------------------
  const [liveIds, setLiveIds] = useState<string[]>([]);
  const [justInAthleteIds, setJustInAthleteIds] = useState<string[]>([]);
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    const channel = supabase
      .channel("attendance-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, (payload) => {
        const row = (payload.new ?? {}) as { id?: string; athlete_id?: string; session_date?: string; present?: boolean };
        qc.invalidateQueries({ queryKey: ["attendance"] });
        qc.invalidateQueries({ queryKey: ["athletes"] });
        if (row.id && row.session_date === sessionDate) {
          setLiveIds((prev) => [row.id!, ...prev.filter((x) => x !== row.id)].slice(0, 30));
          window.setTimeout(() => setLiveIds((prev) => prev.filter((x) => x !== row.id)), 20000);
        }
        if (row.athlete_id && row.session_date === sessionDate && row.present) {
          const aid = row.athlete_id;
          setJustInAthleteIds((prev) => [aid, ...prev.filter((x) => x !== aid)]);
          window.setTimeout(() => setJustInAthleteIds((prev) => prev.filter((x) => x !== aid)), 4000);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bodyweight_logs" }, () => {
        qc.invalidateQueries({ queryKey: ["bodyweight_logs"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc, sessionDate]);

  const recentCheckIns = useMemo(() => {
    return attendance
      .filter((r) => r.session_date === sessionDate && r.present)
      .map((r) => ({ row: r, at: r.updated_at ?? r.created_at ?? "" }))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, 12);
  }, [attendance, sessionDate]);

  useEffect(() => {
    for (const { row } of recentCheckIns) seen.current.add(row.id);
  }, [recentCheckIns]);

  const timeAgo = (iso: string) => {
    if (!iso) return "";
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  };


  const set = useMutation({
    mutationFn: async ({ athlete_id, present }: { athlete_id: string; present: boolean }) => {
      const organization_id = await getScopedOrgId();
      const { error } = await supabase.from("attendance").upsert(
        { athlete_id, session_date: sessionDate, present, organization_id },
        { onConflict: "athlete_id,session_date" },
      );
      if (error) throw error;
    },
    onMutate: async ({ athlete_id, present }) => {
      await qc.cancelQueries({ queryKey: ["attendance"] });
      const prev = qc.getQueryData(attendanceQO.queryKey);
      qc.setQueryData(attendanceQO.queryKey, (old: typeof attendance | undefined) => {
        if (!old) return old;
        const rest = old.filter((r) => !(r.athlete_id === athlete_id && r.session_date === sessionDate));
        return [{ id: `tmp-${athlete_id}-${sessionDate}`, athlete_id, session_date: sessionDate, present, notes: null }, ...rest];
      });
      return { prev };
    },
    onError: (e: Error, _v, ctx) => { if (ctx?.prev) qc.setQueryData(attendanceQO.queryKey, ctx.prev); toast.error(toUserMessage(e)); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });

  const markAll = (present: boolean) => {
    roster.forEach((a) => set.mutate({ athlete_id: a.id, present }));
  };

  // History for CSV / stats
  const historyRows = useMemo(() => attendance.filter((r) =>
    rosterIds.has(r.athlete_id) && inDateRange(r.session_date, filters),
  ), [attendance, rosterIds, filters]);

  const summary = useMemo(() => {
    const counts = new Map<string, { p: number; t: number }>();
    for (const r of historyRows) {
      const c = counts.get(r.athlete_id) ?? { p: 0, t: 0 };
      c.t += 1; if (r.present) c.p += 1;
      counts.set(r.athlete_id, c);
    }
    return roster.map((a) => {
      const c = counts.get(a.id) ?? { p: 0, t: 0 };
      return { athlete: a, present: c.p, total: c.t, pct: c.t ? (c.p / c.t) * 100 : null };
    });
  }, [historyRows, roster]);

  const exportCSV = () => downloadCSV("attendance.csv", historyRows.map((r) => {
    const a = byId.get(r.athlete_id);
    const bw = bwByAthleteDate.get(`${r.athlete_id}:${r.session_date}`);
    return {
      date: r.session_date, athlete: a?.name ?? "", sport: a?.sport ?? "",
      grade: a?.grade ?? "", present: r.present ? "yes" : "no",
      bodyweight: bw ?? "",
    };
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Attendance</h1>
          <p className="text-sm text-muted-foreground">Tap to check athletes in for a session.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowQr((v) => !v)}><QrCode className="h-4 w-4" /> Check-in QR</Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!historyRows.length}><Download className="h-4 w-4" /> CSV</Button>
        </div>
      </div>

      {showQr && (
        <Card className="border-primary/40">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">No-PIN roster check-in</CardTitle>
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                <Users className="h-3 w-3" /> No login
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Athletes scan, find their name on the team roster, enter bodyweight, and are marked present for today.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-w-xs">
              <Label className="text-xs">Team</Label>
              <Select value={qrTeam?.id ?? ""} onValueChange={setQrTeamId}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Select a team" /></SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (<SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {rosterUrl ? (
              <>
                <div className="flex justify-center">
                  <div className="rounded-md bg-white p-4 shadow-sm">
                    <QRCodeSVG value={rosterUrl} size={240} level="M" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Direct link</Label>
                  <div className="flex gap-2">
                    <Input value={rosterUrl} readOnly className="text-xs" />
                    <Button size="icon" variant="outline" onClick={() => { void navigator.clipboard.writeText(rosterUrl); toast.success("Link copied"); }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Create a team first to generate a roster check-in code.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--color-success)] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--color-success)]" />
              </span>
              Just checked in
            </CardTitle>
            <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              <Radio className="h-3 w-3" /> Live
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {recentCheckIns.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No check-ins yet for {sessionDate}. Scans from the QR code appear here instantly.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recentCheckIns.map(({ row, at }) => {
                const a = byId.get(row.athlete_id);
                const isNew = liveIds.includes(row.id);
                const bw = bwByAthleteDate.get(`${row.athlete_id}:${row.session_date}`);
                return (
                  <li key={row.id} className={cn("flex items-center gap-3 py-2 transition-colors", isNew && "-mx-2 rounded-md bg-[color:var(--color-success)]/10 px-2")}>
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-success)]/15 text-[color:var(--color-success)]">
                      <Check className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{a?.name ?? "Athlete"}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[a?.sport, a?.grade && `G${a.grade}`, a?.class_period && `P${a.class_period}`].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {bw != null && (
                      <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{bw} lb</span>
                    )}
                    {isNew && <Badge className="bg-[color:var(--color-success)] text-[color:var(--color-success-foreground)]">New</Badge>}
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{timeAgo(at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>


      <Filters value={filters} onChange={setFilters} athletes={athletes} />

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Session check-in</CardTitle>
              <div className="flex items-center gap-1 rounded-md bg-muted p-0.5 text-xs">
                <button
                  type="button"
                  className={cn("rounded px-2 py-1 font-medium transition-colors", view === "list" ? "bg-background shadow-sm" : "text-muted-foreground")}
                  onClick={() => setView("list")}
                >
                  List
                </button>
                <button
                  type="button"
                  className={cn("rounded px-2 py-1 font-medium transition-colors", view === "board" ? "bg-background shadow-sm" : "text-muted-foreground")}
                  onClick={() => setView("board")}
                >
                  Board
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} className="w-40" />
              {view === "list" && (
                <>
                  <Button size="sm" variant="outline" onClick={() => markAll(true)}>All in</Button>
                  <Button size="sm" variant="ghost" onClick={() => markAll(false)}>Clear</Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {roster.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No athletes match your filters.</div>
          ) : view === "board" ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {roster.map((a) => {
                const present = todayMap.get(a.id) === true;
                const bw = todayBwMap.get(a.id);
                const justIn = justInAthleteIds.includes(a.id);
                return (
                  <div
                    key={a.id}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-all duration-500",
                      present
                        ? "border-[color:var(--color-success)]/50 bg-[color:var(--color-success)]/15"
                        : "border-border/50 bg-muted/20",
                      justIn && "scale-[1.04] ring-2 ring-[color:var(--color-success)]",
                    )}
                  >
                    {present ? (
                      <Check className="h-5 w-5 text-[color:var(--color-success)]" />
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/25" />
                    )}
                    <div className="w-full truncate text-sm font-semibold">{a.name}</div>
                    {bw != null && <div className="text-[11px] tabular-nums text-muted-foreground">{bw} lb</div>}
                  </div>
                );
              })}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {roster.map((a) => {
                const present = todayMap.get(a.id);
                const bw = todayBwMap.get(a.id);
                return (
                  <li key={a.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{a.name}</div>
                      <div className="text-xs text-muted-foreground">{[a.sport, a.grade && `G${a.grade}`, a.position].filter(Boolean).join(" · ")}</div>
                    </div>
                    {bw != null && (
                      <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{bw} lb</span>
                    )}
                    <div className="flex gap-1">
                      <Button
                        size="icon" variant={present === true ? "default" : "outline"}
                        className={cn(present === true && "bg-[color:var(--color-success)] text-[color:var(--color-success-foreground)] hover:opacity-90")}
                        onClick={() => set.mutate({ athlete_id: a.id, present: true })}
                        aria-label="Present"
                      ><Check className="h-4 w-4" /></Button>
                      <Button
                        size="icon" variant={present === false ? "default" : "outline"}
                        className={cn(present === false && "bg-destructive text-destructive-foreground hover:opacity-90")}
                        onClick={() => set.mutate({ athlete_id: a.id, present: false })}
                        aria-label="Absent"
                      ><X className="h-4 w-4" /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Attendance summary</CardTitle></CardHeader>
        <CardContent>
          {summary.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No data yet.</div>
          ) : (
            <ul className="divide-y divide-border">
              {[...summary].sort((a, b) => b.present - a.present).map(({ athlete, present, total, pct }) => (
                <li key={athlete.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{athlete.name}</div>
                    <div className="text-xs text-muted-foreground">{present} of {total} sessions</div>
                  </div>
                  <Badge variant={pct != null && pct >= 90 ? "default" : "secondary"} className={cn(pct != null && pct >= 90 && "bg-[color:var(--color-success)] text-[color:var(--color-success-foreground)]")}>
                    {pct != null ? `${pct.toFixed(0)}%` : "—"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
