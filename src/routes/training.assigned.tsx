import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { workoutAssignmentsQO, workoutsQO, teamsQO, athletesQO } from "@/lib/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/page-header";
import { InlineSkeleton } from "@/components/loading";
import { CalendarClock } from "lucide-react";

export const Route = createFileRoute("/training/assigned")({
  head: () => ({ meta: [{ title: "Training — Assigned" }] }),
  component: AssignedView,
});

function AssignedView() {
  const [q, setQ] = useState("");
  const { data: assignments = [], isLoading } = useQuery(workoutAssignmentsQO);
  const { data: workouts = [] } = useQuery(workoutsQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: athletes = [] } = useQuery(athletesQO);
  const today = new Date().toISOString().slice(0, 10);

  const upcoming = useMemo(() => {
    const term = q.trim().toLowerCase();
    return assignments
      .filter((a) => a.scheduled_date >= today)
      .filter((a) => {
        if (!term) return true;
        const w = workouts.find((x) => x.id === a.workout_id)?.name ?? "";
        const t = a.team_id ? teams.find((x) => x.id === a.team_id)?.name ?? "" : "";
        const ath = a.athlete_id ? athletes.find((x) => x.id === a.athlete_id)?.name ?? "" : "";
        return [w, t, ath].some((s) => s.toLowerCase().includes(term));
      })
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  }, [assignments, workouts, teams, athletes, q, today]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="font-medium">Upcoming assignments</div>
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        </div>
        {isLoading ? (
          <InlineSkeleton rows={4} />
        ) : upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={q ? "No assignments match your search" : "Nothing scheduled yet"}
            description={
              q
                ? "Try a different name or clear the search."
                : "Assign a workout to a team or athlete from the Session Builder to see it here."
            }
            action={
              !q ? (
                <Button asChild size="sm" variant="outline">
                  <Link to="/programming">Open Session Builder</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {upcoming.map((a) => {
              const w = workouts.find((x) => x.id === a.workout_id);
              const t = a.team_id ? teams.find((x) => x.id === a.team_id) : null;
              const ath = a.athlete_id ? athletes.find((x) => x.id === a.athlete_id) : null;
              return (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{w?.name ?? "Session"}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.scheduled_date} · {t?.name ?? ath?.name ?? "All athletes"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.status && <Badge variant="outline" className="capitalize">{a.status}</Badge>}
                    <Button asChild size="sm" variant="outline">
                      <Link to="/workouts/$id" params={{ id: a.workout_id }}>Open</Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

