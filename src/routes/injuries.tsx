import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { athletesQO, athleteInjuriesQO, teamsQO, athleteDisplayName } from "@/lib/queries";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SEVERITY_LABEL, SEVERITY_CLASS } from "@/components/athlete-injury-history";
import { HeartPulse, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";

export const Route = createFileRoute("/injuries")({
  head: () => ({ meta: [{ title: "Injuries — Strength Lab" }] }),
  component: InjuriesPage,
});

function daysSince(dateStr: string): number {
  const ms = Date.now() - new Date(`${dateStr}T00:00:00`).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

function InjuriesPage() {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: injuries = [] } = useQuery(athleteInjuriesQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const [teamFilter, setTeamFilter] = useState("all");

  const athleteById = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const filtered = useMemo(
    () =>
      injuries.filter((i) => {
        if (teamFilter === "all") return true;
        return athleteById.get(i.athlete_id)?.team_id === teamFilter;
      }),
    [injuries, teamFilter, athleteById],
  );

  const active = filtered
    .filter((i) => !i.resolved_on)
    .sort((a, b) => a.started_on.localeCompare(b.started_on));
  const past = filtered
    .filter((i) => i.resolved_on)
    .sort((a, b) => b.started_on.localeCompare(a.started_on))
    .slice(0, 30);

  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("athlete_injuries" as never)
        .update({ resolved_on: new Date().toISOString().slice(0, 10) } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["athlete_injuries"] });
      toast.success("Marked resolved");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Roster health"
        title="Injuries"
        description="Who's currently hurt, and the history behind it — logged from each athlete's profile."
        actions={
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
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
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">
              Currently out <span className="text-muted-foreground">({active.length})</span>
            </div>
          </div>
          {active.length === 0 ? (
            <EmptyState
              icon={HeartPulse}
              title="Nobody's currently flagged"
              description="Log an injury from an athlete's profile page and it'll show up here."
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {active.map((inj) => {
                const a = athleteById.get(inj.athlete_id);
                const team = a ? teamById.get(a.team_id ?? "") : null;
                return (
                  <li key={inj.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {a ? (
                          <Link
                            to="/athletes/$id"
                            params={{ id: a.id }}
                            className="truncate font-medium hover:underline"
                          >
                            {athleteDisplayName(a)}
                          </Link>
                        ) : (
                          <span className="truncate font-medium text-muted-foreground">
                            Unknown athlete
                          </span>
                        )}
                        <Badge variant="outline" className={SEVERITY_CLASS[inj.severity]}>
                          {SEVERITY_LABEL[inj.severity]}
                        </Badge>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {inj.description}
                        {inj.body_part && ` · ${inj.body_part}`}
                        {team && ` · ${team.name}`}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {daysSince(inj.started_on)}d
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1"
                      onClick={() => resolve.mutate(inj.id)}
                      disabled={resolve.isPending}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Resolved
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 text-sm font-semibold">Recently resolved</div>
          {past.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nothing resolved yet.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {past.map((inj) => {
                const a = athleteById.get(inj.athlete_id);
                return (
                  <li key={inj.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1 text-sm">
                      {a ? (
                        <Link
                          to="/athletes/$id"
                          params={{ id: a.id }}
                          className="font-medium hover:underline"
                        >
                          {athleteDisplayName(a)}
                        </Link>
                      ) : (
                        <span className="font-medium text-muted-foreground">Unknown athlete</span>
                      )}
                      <span className="text-muted-foreground"> · {inj.description}</span>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {inj.started_on} – {inj.resolved_on}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
