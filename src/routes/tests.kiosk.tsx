// A walk-up station for max-testing days, in two modes:
// - Form: one rectangle with exactly three things on it — pick the athlete,
//   pick the metric, enter the score — for a coach running the station.
// - Board: a wall-mounted grid of every athlete's name, one metric at a
//   time, for athletes to self-serve — tap your name, enter your score, the
//   tile lights up green. Mirrors the Attendance page's List/Board pattern.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  athletesQO,
  testTypesQO,
  customMetricsQO,
  testsQO,
  athleteTeamsQO,
  type Athlete,
  type TestRow,
} from "@/lib/queries";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import { mergedTestTypes } from "@/lib/domain";
import { validateTestValue, implausibleJump } from "@/lib/validation";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { emptyFilters, filterAthletes } from "@/components/filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { AthleteCombobox } from "@/components/athlete-combobox";
import { ArrowLeft, Check, Search, Maximize2, Minimize2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fullscreenApiSupported } from "@/lib/fullscreen";

export const Route = createFileRoute("/tests/kiosk")({
  head: () => ({
    meta: [{ title: "Test Kiosk — Strength Lab" }, { name: "robots", content: "noindex" }],
  }),
  component: TestKioskPage,
});

const KIOSK_METRIC_KEY = "sl.testKiosk.metric";
const KIOSK_VIEW_KEY = "sl.testKiosk.view";

function lastNameOf(a: Athlete): string {
  return (a.last_name || a.name.trim().split(/\s+/).slice(-1)[0] || "").toLowerCase();
}

type JumpConfirm = {
  pct: number;
  priorBest: number;
  unit: string;
  name: string;
  proceed: () => void;
};

function TestKioskPage() {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const { data: customMetrics = [] } = useQuery(customMetricsQO);
  const { data: tests = [] } = useQuery(testsQO);
  const { data: athleteTeams = [] } = useQuery(athleteTeamsQO);
  const [activeTeamId] = useActiveTeamId();

  const allTestTypes = useMemo(
    () => mergedTestTypes(customTypes, customMetrics),
    [customTypes, customMetrics],
  );
  const groups = useMemo(
    () => Array.from(new Set(allTestTypes.map((t) => t.group))),
    [allTestTypes],
  );

  const [view, setView] = useState<"form" | "board">(
    () =>
      ((typeof window !== "undefined" ? window.localStorage.getItem(KIOSK_VIEW_KEY) : null) as
        "form" | "board" | null) ?? "form",
  );
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(KIOSK_VIEW_KEY, view);
  }, [view]);

  const [testType, setTestType] = useState(
    () =>
      (typeof window !== "undefined" ? window.localStorage.getItem(KIOSK_METRIC_KEY) : null) ?? "",
  );
  useEffect(() => {
    if (typeof window !== "undefined" && testType) {
      window.localStorage.setItem(KIOSK_METRIC_KEY, testType);
    }
  }, [testType]);

  const [athleteId, setAthleteId] = useState("");
  const [value, setValue] = useState("");
  const [confirmJump, setConfirmJump] = useState<JumpConfirm | null>(null);

  const meta = allTestTypes.find((t) => t.value === testType);

  const priorBestFor = (aId: string, tType: string): number | null => {
    const typeMeta = allTestTypes.find((t) => t.value === tType);
    if (!typeMeta) return null;
    let best: number | null = null;
    for (const t of tests) {
      if (t.athlete_id !== aId || t.test_type !== tType) continue;
      const v = Number(t.value);
      if (best == null || (typeMeta.lowerIsBetter ? v < best : v > best)) best = v;
    }
    return best;
  };

  // --- Form view -----------------------------------------------------------

  const save = useMutation({
    mutationFn: async () => {
      if (!athleteId) throw new Error("Pick an athlete");
      if (!testType) throw new Error("Pick a metric");
      const val = Number(value);
      if (!val || Number.isNaN(val)) throw new Error("Enter a valid score");
      const organization_id = await getScopedOrgId();
      const { error } = await supabase.from("tests").insert({
        organization_id,
        athlete_id: athleteId,
        test_type: testType,
        value: val,
        unit: meta?.unit ?? "",
        test_date: new Date().toISOString().slice(0, 10),
      });
      if (error) throw error;
      return val;
    },
    onSuccess: (val) => {
      qc.invalidateQueries({ queryKey: ["tests"] });
      const name = athletes.find((a) => a.id === athleteId)?.name ?? "Athlete";
      toast.success(`Saved — ${name}: ${val} ${meta?.unit ?? ""}`);
      setAthleteId("");
      setValue("");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  // A typo (one digit off, or a seconds/mph mix-up) reads as a wild PR when
  // it's really a mistake — catch it before it hits the table, not after.
  const attemptSave = () => {
    if (!athleteId || !testType || !value.trim()) return;
    const val = Number(value);
    if (!val || Number.isNaN(val)) {
      toast.error("Enter a valid score");
      return;
    }
    const boundsError = validateTestValue(testType, val);
    if (boundsError) {
      toast.error(boundsError);
      return;
    }
    const priorBest = priorBestFor(athleteId, testType);
    const pct = implausibleJump(val, priorBest, meta?.lowerIsBetter ?? false);
    if (pct != null && priorBest != null) {
      const name = athletes.find((a) => a.id === athleteId)?.name ?? "This athlete";
      setConfirmJump({
        pct,
        priorBest,
        unit: meta?.unit ?? "",
        name,
        proceed: () => save.mutate(),
      });
      return;
    }
    save.mutate();
  };

  // --- Board view ------------------------------------------------------------

  const [boardSearch, setBoardSearch] = useState("");
  const [entry, setEntry] = useState<{
    athleteId: string;
    name: string;
    existingId: string | null;
    value: string;
  } | null>(null);

  const teamsByAthlete = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of athleteTeams) {
      const s = m.get(r.athlete_id) ?? new Set<string>();
      s.add(r.team_id);
      m.set(r.athlete_id, s);
    }
    return m;
  }, [athleteTeams]);
  const roster = useMemo(
    () => filterAthletes(athletes, emptyFilters, activeTeamId, teamsByAthlete),
    [athletes, activeTeamId, teamsByAthlete],
  );
  const boardRoster = useMemo(() => {
    const q = boardSearch.trim().toLowerCase();
    return [...roster]
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .sort((a, b) => lastNameOf(a).localeCompare(lastNameOf(b)));
  }, [roster, boardSearch]);

  const todayMap = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const m = new Map<string, TestRow>();
    if (!testType) return m;
    for (const t of tests) {
      if (t.test_type === testType && t.test_date === today) m.set(t.athlete_id, t);
    }
    return m;
  }, [tests, testType]);
  const loggedCount = useMemo(
    () => boardRoster.filter((a) => todayMap.has(a.id)).length,
    [boardRoster, todayMap],
  );

  const boardCardRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreenApiSupported()) return;
    const onChange = () => setIsFullscreen(document.fullscreenElement === boardCardRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (!fullscreenApiSupported()) {
      setIsFullscreen((v) => !v);
      return;
    }
    if (document.fullscreenElement) void document.exitFullscreen();
    else void boardCardRef.current?.requestFullscreen();
  };

  const openEntry = (a: Athlete) => {
    const existing = todayMap.get(a.id);
    setEntry({
      athleteId: a.id,
      name: a.name,
      existingId: existing?.id ?? null,
      value: existing ? String(existing.value) : "",
    });
  };

  const boardSave = useMutation({
    mutationFn: async (payload: { athleteId: string; existingId: string | null; val: number }) => {
      if (payload.existingId) {
        const { error } = await supabase
          .from("tests")
          .update({ value: payload.val })
          .eq("id", payload.existingId);
        if (error) throw error;
      } else {
        const organization_id = await getScopedOrgId();
        const { error } = await supabase.from("tests").insert({
          organization_id,
          athlete_id: payload.athleteId,
          test_type: testType,
          value: payload.val,
          unit: meta?.unit ?? "",
          test_date: new Date().toISOString().slice(0, 10),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tests"] });
      toast.success("Saved");
      setEntry(null);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const attemptBoardSave = () => {
    if (!entry || !testType) return;
    const val = Number(entry.value);
    if (!val || Number.isNaN(val)) {
      toast.error("Enter a valid score");
      return;
    }
    const boundsError = validateTestValue(testType, val);
    if (boundsError) {
      toast.error(boundsError);
      return;
    }
    const payload = { athleteId: entry.athleteId, existingId: entry.existingId, val };
    const priorBest = priorBestFor(entry.athleteId, testType);
    const pct = implausibleJump(val, priorBest, meta?.lowerIsBetter ?? false);
    if (pct != null && priorBest != null) {
      setConfirmJump({
        pct,
        priorBest,
        unit: meta?.unit ?? "",
        name: entry.name,
        proceed: () => boardSave.mutate(payload),
      });
      return;
    }
    boardSave.mutate(payload);
  };

  return (
    <div className="relative min-h-[100dvh] bg-background p-4">
      <Link
        to="/tests"
        className="absolute left-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Exit kiosk"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-md bg-muted p-0.5 text-xs">
        <button
          type="button"
          className={cn(
            "rounded px-2 py-1 font-medium transition-colors",
            view === "form" ? "bg-background shadow-sm" : "text-muted-foreground",
          )}
          onClick={() => setView("form")}
        >
          Form
        </button>
        <button
          type="button"
          className={cn(
            "rounded px-2 py-1 font-medium transition-colors",
            view === "board" ? "bg-background shadow-sm" : "text-muted-foreground",
          )}
          onClick={() => setView("board")}
        >
          Board
        </button>
      </div>

      {view === "form" ? (
        <div className="flex min-h-[100dvh] items-center justify-center">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>Log a test</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">Athlete</Label>
                <AthleteCombobox
                  athletes={athletes}
                  value={athleteId}
                  onChange={setAthleteId}
                  placeholder="Select athlete"
                  triggerClassName="h-12 text-base"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Metric</Label>
                <Select value={testType} onValueChange={setTestType}>
                  <SelectTrigger className="h-12 text-base">
                    <SelectValue placeholder="Choose a metric" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectGroup key={g}>
                        <SelectLabel>{g}</SelectLabel>
                        {allTestTypes
                          .filter((t) => t.group === g)
                          .map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label} ({t.unit})
                            </SelectItem>
                          ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Score{meta?.unit ? ` (${meta.unit})` : ""}
                </Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="h-12 text-base"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !save.isPending) attemptSave();
                  }}
                />
              </div>
              <Button
                className="h-12 w-full text-base"
                disabled={save.isPending || !athleteId || !testType || !value.trim()}
                onClick={attemptSave}
              >
                {save.isPending ? "Saving…" : "Log test"}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="mx-auto max-w-5xl pt-16">
          <Card
            ref={boardCardRef}
            className={cn(
              isFullscreen &&
                "fixed inset-0 z-50 m-0 overflow-y-auto rounded-none border-0 bg-background p-4",
            )}
          >
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Test Kiosk — Board</CardTitle>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                >
                  {isFullscreen ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Select value={testType} onValueChange={setTestType}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Choose a metric" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectGroup key={g}>
                        <SelectLabel>{g}</SelectLabel>
                        {allTestTypes
                          .filter((t) => t.group === g)
                          .map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label} ({t.unit})
                            </SelectItem>
                          ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={boardSearch}
                    onChange={(e) => setBoardSearch(e.target.value)}
                    placeholder="Find a name…"
                    className="h-11 pl-9"
                  />
                </div>
              </div>
              {testType && boardRoster.length > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {loggedCount}/{boardRoster.length} logged
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[color:var(--color-success)] transition-all"
                      style={{ width: `${(loggedCount / boardRoster.length) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {!testType ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Pick a metric above to start the board.
                </div>
              ) : boardRoster.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No athletes match "{boardSearch}".
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {boardRoster.map((a) => {
                    const row = todayMap.get(a.id);
                    const logged = row != null;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => openEntry(a)}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-all duration-500 active:scale-95",
                          logged
                            ? "border-[color:var(--color-success)]/50 bg-[color:var(--color-success)]/15"
                            : "border-border/50 bg-muted/20 hover:border-primary/40 hover:bg-primary/5",
                        )}
                      >
                        {logged ? (
                          <Check className="h-5 w-5 text-[color:var(--color-success)]" />
                        ) : (
                          <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/25" />
                        )}
                        <div className="w-full truncate text-sm font-semibold">{a.name}</div>
                        {logged && (
                          <div className="text-[11px] tabular-nums text-muted-foreground">
                            {row!.value} {row!.unit}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={!!entry} onOpenChange={(v) => !v && setEntry(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{entry?.name}</DialogTitle>
          </DialogHeader>
          <div>
            <Label className="text-xs text-muted-foreground">
              {meta?.label}
              {meta?.unit ? ` (${meta.unit})` : ""}
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              autoFocus
              value={entry?.value ?? ""}
              onChange={(e) =>
                setEntry((prev) => (prev ? { ...prev, value: e.target.value } : prev))
              }
              className="h-12 text-base"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !boardSave.isPending) attemptBoardSave();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEntry(null)}>
              Cancel
            </Button>
            <Button
              onClick={attemptBoardSave}
              disabled={boardSave.isPending || !entry?.value.trim()}
            >
              {boardSave.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmJump} onOpenChange={(v) => !v && setConfirmJump(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Double-check this score</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmJump && (
                <>
                  {confirmJump.name}'s previous best was {confirmJump.priorBest} {confirmJump.unit}.
                  This entry is a {Math.round(Math.abs(confirmJump.pct) * 100)}%{" "}
                  {confirmJump.pct > 0 ? "improvement" : "drop"} in one go — unusual enough that
                  it's often a typo. Save it anyway?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Re-check</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirmJump?.proceed();
                setConfirmJump(null);
              }}
            >
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
