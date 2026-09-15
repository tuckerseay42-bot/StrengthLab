import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { workoutsQO, athletesQO } from "@/lib/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/training/completed")({
  head: () => ({ meta: [{ title: "Training — Completed" }] }),
  component: CompletedView,
});

type RackSession = {
  id: string; workout_id: string | null; team_id: string | null;
  started_at: string | null; ended_at: string | null; status: string | null;
};

function CompletedView() {
  const { data: workouts = [] } = useQuery(workoutsQO);
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: sessions = [] } = useQuery({
    queryKey: ["rack_sessions_recent"],
    queryFn: async () => {
      const { data, error } = await supabase.from("rack_sessions")
        .select("*").order("started_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as RackSession[];
    },
  });
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  const { data: setsBySession = [] } = useQuery({
    queryKey: ["rack_set_logs_for_sessions", sessionIds.join(",")],
    enabled: sessionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("rack_set_logs")
        .select("rack_session_id, athlete_id, status, approval_status, load, reps")
        .in("rack_session_id", sessionIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const bySession = useMemo(() => {
    const m = new Map<string, { athletes: Set<string>; completed: number; flagged: number; totalReps: number; totalVolume: number }>();
    for (const s of setsBySession) {
      const key = (s as { rack_session_id: string }).rack_session_id;
      if (!m.has(key)) m.set(key, { athletes: new Set(), completed: 0, flagged: 0, totalReps: 0, totalVolume: 0 });
      const bucket = m.get(key)!;
      if (s.athlete_id) bucket.athletes.add(s.athlete_id);
      if (s.status === "completed") bucket.completed += 1;
      if (s.approval_status === "pending") bucket.flagged += 1;
      const reps = Number(s.reps ?? 0), load = Number(s.load ?? 0);
      if (reps > 0) bucket.totalReps += reps;
      if (reps > 0 && load > 0) bucket.totalVolume += reps * load;
    }
    return m;
  }, [setsBySession]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 font-medium">Recent sessions</div>
        {sessions.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No sessions yet.
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {sessions.map((s) => {
              const w = s.workout_id ? workouts.find((x) => x.id === s.workout_id) : null;
              const stats = bySession.get(s.id);
              const when = s.started_at ? new Date(s.started_at).toLocaleString() : "—";
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{w?.name ?? "Session"}</div>
                    <div className="text-xs text-muted-foreground">
                      {when}
                      {stats && ` · ${stats.athletes.size} athletes · ${stats.completed} sets · ${Math.round(stats.totalVolume).toLocaleString()} lb volume`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {stats && stats.flagged > 0 && (
                      <Badge variant="outline" className="border-[color:var(--status-near)] text-[color:var(--status-near)]">
                        {stats.flagged} flagged
                      </Badge>
                    )}
                    {s.status && <Badge variant="outline" className="capitalize">{s.status}</Badge>}
                    <Button asChild size="sm" variant="outline">
                      <Link to="/rack-console" search={{ session: s.id }}>Open</Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {athletes.length} athletes tracked · session summaries with PR export ship in the next phase.
        </p>
      </CardContent>
    </Card>
  );
}
