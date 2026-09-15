import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Maximize2,
  Minimize2,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Settings2,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/overhead-display")({
  head: () => ({
    meta: [
      { title: "Overhead Display — Strength Lab" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OverheadDisplayPage,
});

type Phase = "work" | "rest";

function fmt(s: number) {
  const m = Math.floor(Math.max(0, s) / 60);
  const sec = Math.max(0, s) % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function OverheadDisplayPage() {
  // ---- Selection state ----
  const [teamId, setTeamId] = useState<string>("all");
  const [programId, setProgramId] = useState<string>("auto");

  // ---- Timer / rotation state ----
  const [workSec, setWorkSec] = useState(180); // per-round work
  const [restSec, setRestSec] = useState(45); // transition between rounds
  const [rounds, setRounds] = useState(5);
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState<Phase>("work");
  const [remaining, setRemaining] = useState(180);
  const [running, setRunning] = useState(false);
  const [fs, setFs] = useState(false);

  // Reset countdown when durations change and timer isn't running
  useEffect(() => {
    if (!running) setRemaining(phase === "work" ? workSec : restSec);
  }, [workSec, restSec, phase, running]);

  // Tick
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setRemaining((r) => {
        if (r > 1) return r - 1;
        // phase transition
        setPhase((p) => {
          if (p === "work") {
            // move to rest, unless last round
            if (round >= rounds) {
              setRunning(false);
              return "work";
            }
            return "rest";
          }
          // rest -> next work round
          setRound((n) => Math.min(rounds, n + 1));
          return "work";
        });
        return 0; // will be reset by the effect below
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, round, rounds]);

  // When phase flips to 0 remaining, seed next duration
  useEffect(() => {
    if (remaining === 0) {
      setRemaining(phase === "work" ? workSec : restSec);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Fullscreen tracking
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  const skipPhase = () => {
    if (phase === "work") {
      if (round >= rounds) {
        setRunning(false);
        setRemaining(workSec);
        return;
      }
      setPhase("rest");
      setRemaining(restSec);
    } else {
      setRound((n) => Math.min(rounds, n + 1));
      setPhase("work");
      setRemaining(workSec);
    }
  };
  const forceNextRound = () => {
    setRound((n) => Math.min(rounds, n + 1));
    setPhase("work");
    setRemaining(workSec);
  };
  const resetTimer = () => {
    setRunning(false);
    setRound(1);
    setPhase("work");
    setRemaining(workSec);
  };

  // ---- Data ----
  const { data: teams = [] } = useQuery({
    queryKey: ["od-teams"],
    queryFn: async () => {
      const { data } = await supabase
        .from("teams")
        .select("id, name")
        .is("archived_at", null)
        .order("name");
      return data ?? [];
    },
  });
  const { data: programs = [] } = useQuery({
    queryKey: ["od-programs", teamId],
    queryFn: async () => {
      let q = supabase
        .from("programs")
        .select("id, name, team_id")
        .order("updated_at", { ascending: false });
      if (teamId !== "all") q = q.eq("team_id", teamId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const today = useMemo(todayIso, []);

  const { data: resolvedWorkoutId } = useQuery({
    queryKey: ["od-resolve", teamId, programId, today, programs.length],
    queryFn: async () => {
      if (teamId !== "all") {
        const { data: a } = await supabase
          .from("workout_assignments")
          .select("workout_id")
          .eq("team_id", teamId)
          .eq("scheduled_date", today)
          .maybeSingle();
        if (a?.workout_id) return a.workout_id as string;
      }
      const pid = programId === "auto" ? programs[0]?.id : programId;
      if (pid) {
        const { data: s } = await supabase
          .from("program_sessions")
          .select("workout_id, scheduled_date")
          .eq("program_id", pid)
          .order("scheduled_date", { ascending: true })
          .limit(60);
        const match = s?.find((r) => r.scheduled_date === today) ?? s?.[0];
        if (match?.workout_id) return match.workout_id as string;
      }
      return null;
    },
  });

  const { data: workout } = useQuery({
    queryKey: ["od-workout", resolvedWorkoutId],
    enabled: !!resolvedWorkoutId,
    queryFn: async () => {
      const { data: w } = await supabase
        .from("workouts")
        .select("id, name, notes")
        .eq("id", resolvedWorkoutId!)
        .maybeSingle();
      const { data: blocks } = await supabase
        .from("workout_blocks")
        .select("id, name, position")
        .eq("workout_id", resolvedWorkoutId!)
        .order("position");
      const { data: exs } = await supabase
        .from("workout_exercises")
        .select(
          "id, block_id, exercise_name, position, sets, reps, load, percent, tempo, rest_seconds, superset_group, notes",
        )
        .eq("workout_id", resolvedWorkoutId!)
        .order("position");
      return { workout: w, blocks: blocks ?? [], exercises: exs ?? [] };
    },
  });

  const blocks = useMemo(() => {
    if (!workout) return [] as Array<{ id: string; letter: string; name: string; exs: any[] }>;
    const list = workout.blocks.length
      ? workout.blocks
      : [{ id: "_", name: "Workout", position: 0 } as any];
    return list.map((b: any, i: number) => ({
      id: b.id,
      letter: String.fromCharCode(65 + i),
      name: b.name || "Block",
      exs: workout.exercises.filter((e) =>
        b.id === "_" ? true : e.block_id === b.id,
      ),
    }));
  }, [workout]);

  const isRest = phase === "rest";
  const dateLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }, []);

  return (
    <div
      className={cn(
        "min-h-screen w-full text-slate-50 transition-colors duration-700",
        isRest
          ? "bg-[radial-gradient(1200px_600px_at_50%_-10%,#1e293b_0%,#0b1220_60%,#070b16_100%)]"
          : "bg-[radial-gradient(1200px_600px_at_50%_-10%,#1e3a8a_0%,#0f172a_55%,#070b16_100%)]",
      )}
    >
      {/* Top bar */}
      <div className="flex items-center gap-2 px-6 pt-4 text-xs text-slate-300/80">
        <span className="tracking-widest uppercase">{dateLabel}</span>
        <span className="opacity-40">·</span>
        <span className="truncate">
          {workout?.workout?.name ?? "No workout scheduled"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={teamId}
            onValueChange={(v) => setTeamId(v)}
          >
            <SelectTrigger className="h-8 w-36 border-white/10 bg-white/5 text-xs">
              <SelectValue placeholder="Team" />
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
          <Select value={programId} onValueChange={(v) => setProgramId(v)}>
            <SelectTrigger className="h-8 w-44 border-white/10 bg-white/5 text-xs">
              <SelectValue placeholder="Program" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (latest)</SelectItem>
              {programs.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-200 hover:bg-white/10"
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Work (sec)</Label>
                <Input
                  type="number"
                  min={10}
                  value={workSec}
                  onChange={(e) => setWorkSec(Math.max(10, Number(e.target.value) || 0))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Rest / transition (sec)</Label>
                <Input
                  type="number"
                  min={5}
                  value={restSec}
                  onChange={(e) => setRestSec(Math.max(5, Number(e.target.value) || 0))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Rounds</Label>
                <Input
                  type="number"
                  min={1}
                  value={rounds}
                  onChange={(e) => setRounds(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-200 hover:bg-white/10"
            onClick={toggleFs}
            title={fs ? "Exit full screen" : "Full screen"}
          >
            {fs ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Hero timer */}
      <div className="px-6 pt-6 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-300 backdrop-blur">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              isRest ? "bg-amber-400" : "bg-emerald-400",
              running && "animate-pulse",
            )}
          />
          {isRest ? "Transition" : "Work"}
          <span className="opacity-40">·</span>
          Round {round} of {rounds}
        </div>

        <div className="mt-2 flex justify-center gap-1.5">
          {Array.from({ length: rounds }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1 rounded-full transition-all",
                i + 1 < round && "w-6 bg-emerald-400/70",
                i + 1 === round && "w-10 bg-white",
                i + 1 > round && "w-6 bg-white/15",
              )}
            />
          ))}
        </div>

        <div
          className={cn(
            "mt-4 font-black tabular-nums leading-none tracking-tight",
            "text-[clamp(88px,15vw,220px)]",
            isRest ? "text-amber-100" : "text-white",
          )}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {fmt(remaining)}
        </div>
      </div>

      {/* Blocks grid */}
      <div className="mx-auto mt-8 grid max-w-[1800px] gap-4 px-6 pb-32 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {blocks.map((b) => (
          <BlockCard key={b.id} letter={b.letter} name={b.name} exs={b.exs} />
        ))}
        {!blocks.length && (
          <div className="col-span-full py-20 text-center text-slate-400">
            Pick a team & program above to display today's session.
          </div>
        )}
      </div>

      {/* Floating controls */}
      <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/80 p-1.5 shadow-2xl backdrop-blur">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full text-slate-100 hover:bg-white/10"
            onClick={() => setRunning((r) => !r)}
          >
            {running ? (
              <>
                <Pause className="mr-1 h-4 w-4" /> Pause
              </>
            ) : (
              <>
                <Play className="mr-1 h-4 w-4" /> Start
              </>
            )}
          </Button>
          <div className="h-5 w-px bg-white/10" />
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full text-slate-100 hover:bg-white/10"
            onClick={skipPhase}
          >
            <ChevronRight className="mr-1 h-4 w-4" /> Skip {isRest ? "rest" : "work"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full text-slate-100 hover:bg-white/10"
            onClick={forceNextRound}
          >
            <SkipForward className="mr-1 h-4 w-4" /> Next round
          </Button>
          <div className="h-5 w-px bg-white/10" />
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full text-slate-300 hover:bg-white/10"
            onClick={resetTimer}
          >
            <RotateCcw className="mr-1 h-4 w-4" /> Reset
          </Button>
        </div>
      </div>
    </div>
  );
}

function BlockCard({
  letter,
  name,
  exs,
}: {
  letter: string;
  name: string;
  exs: any[];
}) {
  if (!exs?.length) return null;
  // Group consecutive exercises sharing superset_group
  const groups: Array<{ key: string; superset: boolean; items: any[] }> = [];
  for (const e of exs) {
    const last = groups[groups.length - 1];
    if (e.superset_group && last?.items[0]?.superset_group === e.superset_group) {
      last.items.push(e);
    } else {
      groups.push({
        key: e.id,
        superset: !!e.superset_group,
        items: [e],
      });
    }
  }

  return (
    <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md transition hover:border-white/20 hover:bg-white/[0.06]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-black tracking-tight text-white/90">
            {letter}
          </span>
          <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
            {name}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-slate-500">
          {exs.length} {exs.length === 1 ? "lift" : "lifts"}
        </span>
      </div>

      <ul className="space-y-3">
        {groups.map((g, gi) => (
          <li key={g.key}>
            {gi > 0 && (
              <div className="my-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500">
                <span className="h-px flex-1 bg-white/10" />
                then
                <span className="h-px flex-1 bg-white/10" />
              </div>
            )}
            <div className="rounded-2xl bg-slate-950/40 p-3 ring-1 ring-white/5">
              {g.superset && g.items.length > 1 && (
                <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-indigo-200 ring-1 ring-indigo-400/30">
                  Superset
                </div>
              )}
              <div className="space-y-2">
                {g.items.map((e, i) => (
                  <div key={e.id}>
                    {i > 0 && (
                      <div className="my-1.5 ml-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-indigo-300/70">
                        <span className="h-1 w-1 rounded-full bg-indigo-300/50" />
                        with
                      </div>
                    )}
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xl font-semibold text-white">
                          {e.exercise_name}
                        </div>
                        {e.notes && (
                          <div className="mt-0.5 text-xs text-slate-400">
                            {e.notes}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right font-mono text-sm tabular-nums text-slate-200">
                        <span className="text-white">
                          {e.sets ?? "—"} × {e.reps ?? "—"}
                        </span>
                        {e.load != null && (
                          <span className="ml-1.5 text-slate-400">
                            @ {e.load}
                          </span>
                        )}
                        {e.percent != null && (
                          <span className="ml-1.5 text-slate-400">
                            {e.percent}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
