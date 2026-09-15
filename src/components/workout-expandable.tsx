import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { workoutExercisesQO, workoutSetsQO } from "@/lib/queries";
import { ChevronRight, ChevronDown, Dumbbell, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Expandable Workout → Exercises tree row. Renders as a compact item that
 * expands to show every exercise + its prescribed set summary inline.
 */
export function WorkoutExpandable({
  workout,
  right,
  active,
  className,
}: {
  workout: { id: string; name: string };
  right?: React.ReactNode;
  active?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("rounded-md border bg-background", active && "ring-1 ring-primary/40", className)}>
      <div className="flex items-center gap-1 p-1.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <Dumbbell className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Link
          to="/workouts/$id" params={{ id: workout.id }}
          className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
        >
          {workout.name}
        </Link>
        {right}
      </div>
      {open && <WorkoutExercisesInline workoutId={workout.id} />}
    </div>
  );
}

function WorkoutExercisesInline({ workoutId }: { workoutId: string }) {
  const { data: allEx = [], isPending: ePending } = useQuery(workoutExercisesQO);
  const { data: allSets = [], isPending: sPending } = useQuery(workoutSetsQO);

  if (ePending || sPending) {
    return <div className="border-t px-3 py-2 text-xs text-muted-foreground">Loading…</div>;
  }
  const exs = allEx.filter((e) => e.workout_id === workoutId).sort((a, b) => a.position - b.position);
  if (exs.length === 0) {
    return (
      <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
        <span>No exercises yet.</span>
        <Button asChild size="sm" variant="ghost" className="h-6 text-xs">
          <Link to="/workouts/$id" params={{ id: workoutId }}><Pencil className="h-3 w-3" /> Add</Link>
        </Button>
      </div>
    );
  }
  return (
    <ul className="space-y-0.5 border-t p-2">
      {exs.map((e) => {
        const sets = allSets.filter((s) => s.workout_exercise_id === e.id);
        const summary = sets.length > 0
          ? sets.map((s) => {
              const base = `${s.sets ?? "?"}×${s.reps || "?"}`;
              if (s.load != null) return `${base} @ ${s.load}lb`;
              if (s.rm_reps) return `${base} @ ${s.percent && s.percent !== 100 ? `${s.percent}% of ` : ""}${s.rm_reps}RM`;
              if (s.percent != null) return `${base} @ ${s.percent}%`;
              return base;
            }).join(" · ")
          : `${e.sets ?? "?"}×${e.reps || "?"}`;
        return (
          <li key={e.id} className="flex items-baseline justify-between gap-2 rounded px-2 py-0.5 text-xs hover:bg-muted/40">
            <span className="truncate font-medium">{e.exercise_name || "Unnamed"}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{summary}</span>
          </li>
        );
      })}
    </ul>
  );
}
