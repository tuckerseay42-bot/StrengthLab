import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { workoutAssignmentsQO, workoutsQO, athletesQO, teamsQO } from "@/lib/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/training/calendar")({
  head: () => ({ meta: [{ title: "Training — Calendar" }] }),
  component: CalendarView,
});

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function daysInMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function fmt(d: Date) { return d.toISOString().slice(0, 10); }

function CalendarView() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const { data: assignments = [] } = useQuery(workoutAssignmentsQO);
  const { data: workouts = [] } = useQuery(workoutsQO);
  const { data: teams = [] } = useQuery(teamsQO);
  const { data: athletes = [] } = useQuery(athletesQO);

  const byDate = useMemo(() => {
    const m = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const arr = m.get(a.scheduled_date) ?? [];
      arr.push(a); m.set(a.scheduled_date, arr);
    }
    return m;
  }, [assignments]);

  const first = startOfMonth(cursor);
  const total = daysInMonth(cursor);
  const leadBlanks = first.getDay();
  const cells: (Date | null)[] = [
    ...Array(leadBlanks).fill(null),
    ...Array.from({ length: total }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1)),
  ];
  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const todayKey = fmt(new Date());

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-medium">{monthLabel}</div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCursor(startOfMonth(new Date()))}>Today</Button>
            <Button variant="ghost" size="icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="min-h-[80px] rounded-md bg-muted/20" />;
            const key = fmt(d);
            const items = byDate.get(key) ?? [];
            const isToday = key === todayKey;
            return (
              <div key={i} className={`min-h-[80px] rounded-md border p-1.5 text-left ${isToday ? "border-primary" : "border-border/60"}`}>
                <div className="text-xs font-medium">{d.getDate()}</div>
                <div className="mt-1 space-y-0.5">
                  {items.slice(0, 3).map((a) => {
                    const w = workouts.find((x) => x.id === a.workout_id);
                    const t = a.team_id ? teams.find((x) => x.id === a.team_id) : null;
                    const ath = a.athlete_id ? athletes.find((x) => x.id === a.athlete_id) : null;
                    return (
                      <Link
                        key={a.id}
                        to="/workouts/$id" params={{ id: a.workout_id }}
                        className="block truncate rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-foreground hover:bg-primary/20"
                        title={`${w?.name ?? "Session"} — ${t?.name ?? ath?.name ?? ""}`}
                      >
                        {w?.name ?? "Session"}
                      </Link>
                    );
                  })}
                  {items.length > 3 && (
                    <Badge variant="outline" className="text-[10px]">+{items.length - 3}</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
