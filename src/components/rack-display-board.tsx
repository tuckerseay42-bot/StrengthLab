// Read-only, TV/kiosk-friendly view of today's rack assignments — meant to be
// cast to a monitor in the weight room so athletes can find their own rack
// without asking a coach. Shares the same rack_sessions/rack_session_athletes
// data as the Assign Racks builder and Live Training, but strips out every
// editing control in favor of large, legible cards.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { athletesQO, teamsQO, athleteDisplayName, type Athlete } from "@/lib/queries";
import { useActiveTeamId } from "@/hooks/use-active-team";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/page-header";
import { Maximize2, Minimize2, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const today = () => new Date().toISOString().slice(0, 10);

type RackRow = { id: string; team_id: string; rack_number: number };
type RackMember = { rack_session_id: string; athlete_id: string; quadrant: number };
type RackGroup = RackRow & { athletes: Athlete[] };

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function RackDisplayBoard() {
  const qc = useQueryClient();
  const [activeTeamId] = useActiveTeamId();
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: athletes = [] } = useQuery(athletesQO);
  const [teamId, setTeamId] = useState<string>(activeTeamId ?? "all");
  const [search, setSearch] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const now = useClock();

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  const athleteById = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const racksQ = useQuery({
    queryKey: ["rack-display-racks", today()],
    queryFn: async (): Promise<RackRow[]> => {
      const { data, error } = await supabase
        .from("rack_sessions")
        .select("id, team_id, rack_number")
        .eq("session_date", today())
        .order("rack_number");
      if (error) throw error;
      return (data ?? []) as unknown as RackRow[];
    },
    refetchInterval: 20_000,
  });
  const racks = racksQ.data ?? [];
  const rackIdsKey = racks.map((r) => r.id).join(",");

  const membersQ = useQuery({
    queryKey: ["rack-display-members", rackIdsKey],
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
    refetchInterval: 20_000,
  });
  const members = membersQ.data ?? [];

  // Live updates so the TV never needs a manual refresh.
  useEffect(() => {
    const ch = supabase
      .channel("rack-display-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "rack_sessions" }, () =>
        qc.invalidateQueries({ queryKey: ["rack-display-racks"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rack_session_athletes" },
        () => qc.invalidateQueries({ queryKey: ["rack-display-members"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [qc]);

  const scopedRacks = teamId === "all" ? racks : racks.filter((r) => r.team_id === teamId);

  const rackGroups = useMemo<RackGroup[]>(
    () =>
      scopedRacks
        .map((r) => ({
          ...r,
          athletes: members
            .filter((m) => m.rack_session_id === r.id)
            .sort((a, b) => a.quadrant - b.quadrant)
            .map((m) => athleteById.get(m.athlete_id))
            .filter((a): a is Athlete => !!a),
        }))
        .sort((a, b) => a.rack_number - b.rack_number),
    [scopedRacks, members, athleteById],
  );

  const needle = search.trim().toLowerCase();
  const matchesSearch = (a: Athlete) =>
    !needle || athleteDisplayName(a).toLowerCase().includes(needle);

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const timeLabel = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-bold tracking-tight">Today's Racks</div>
          <div className="text-sm text-muted-foreground">
            {dateLabel} · {timeLabel}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find your name…"
              className="h-9 w-[180px] pl-8 text-sm"
            />
          </div>
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue placeholder="All teams" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={toggleFullscreen}>
            {fullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5 hidden sm:inline">{fullscreen ? "Exit" : "Fullscreen"}</span>
          </Button>
        </div>
      </div>

      {rackGroups.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No racks assigned yet"
          description="Once a coach builds today's rack assignments in the Assign Racks tab, they'll show up here."
        />
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-4 overflow-y-auto pb-4 pr-1 sm:grid-cols-2 xl:grid-cols-3">
          {rackGroups.map((r) => {
            const team = teamById.get(r.team_id) ?? null;
            const teamColor = team?.color || "var(--primary)";
            return (
              <div
                key={r.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.25)]"
              >
                <div
                  className="flex items-center gap-3 px-4 py-3"
                  style={{ background: `color-mix(in srgb, ${teamColor} 14%, transparent)` }}
                >
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl font-black text-white"
                    style={{ backgroundColor: teamColor }}
                  >
                    {r.rack_number}
                  </span>
                  <div className="min-w-0">
                    <div className="text-lg font-bold leading-tight">Rack {r.rack_number}</div>
                    <div className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {team?.name ?? "Unassigned team"}
                    </div>
                  </div>
                </div>
                <div className="flex-1 space-y-1.5 p-3">
                  {r.athletes.length === 0 ? (
                    <div className="py-4 text-center text-sm text-muted-foreground">
                      No athletes assigned
                    </div>
                  ) : (
                    r.athletes.map((a) => {
                      const highlight = needle && matchesSearch(a);
                      return (
                        <div
                          key={a.id}
                          className={cn(
                            "rounded-lg px-3 py-2.5 text-xl font-semibold tracking-tight transition-colors",
                            highlight
                              ? "bg-primary text-primary-foreground"
                              : needle
                                ? "text-muted-foreground/40"
                                : "bg-muted/40 text-foreground",
                          )}
                        >
                          {athleteDisplayName(a)}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
