// A walk-up station for max-testing days. A coach first locks the station to
// one metric — that's all it can log until someone exits back to setup — then
// hands the device to athletes. Each athlete just types their name into one
// centered search box, taps the match, and enters their number on a big
// on-screen keypad. No roster grid, no per-athlete sign-in, no native
// keyboard popping up and eating half the screen: the coach's own session is
// what's authenticated here.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  athletesQO,
  testsQO,
  testTypesQO,
  customMetricsQO,
  athleteDisplayName,
  type Athlete,
} from "@/lib/queries";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import {
  testTypeMeta as baseTestTypeMeta,
  sprintDistanceIn,
  mphToSeconds,
  mergedTestTypes,
} from "@/lib/domain";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Check, Delete, Gauge, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tests/kiosk")({
  head: () => ({
    meta: [{ title: "Test Kiosk — Strength Lab" }, { name: "robots", content: "noindex" }],
  }),
  component: TestKioskPage,
});

const KIOSK_METRIC_KEY = "sl.testKiosk.metric";

function initialsFor(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[p.length - 1]?.[0] ?? "")).toUpperCase() || "?";
}

function TestKioskPage() {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: tests = [] } = useQuery(testsQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const { data: customMetrics = [] } = useQuery(customMetricsQO);

  // Same test-type merge as the main Tests page: built-ins + org-defined
  // test types + Custom Metrics page entries, deduped by value.
  const allTestTypes = useMemo(
    () => mergedTestTypes(customTypes, customMetrics),
    [customTypes, customMetrics],
  );

  const groups = useMemo(
    () => Array.from(new Set(allTestTypes.map((t) => t.group))),
    [allTestTypes],
  );

  // A kiosk "session" is locked to one metric for its whole life — the coach
  // picks it once on this setup screen, and the only way to change it is to
  // exit the session and come back through setup again.
  const [stage, setStage] = useState<"setup" | "active">("setup");
  const [testType, setTestType] = useState(
    () =>
      (typeof window !== "undefined" ? window.localStorage.getItem(KIOSK_METRIC_KEY) : null) ?? "",
  );

  const meta = allTestTypes.find((t) => t.value === testType) ?? baseTestTypeMeta(testType);
  const dist = sprintDistanceIn(testType);

  const [search, setSearch] = useState("");
  const [athleteId, setAthleteId] = useState("");
  const [value, setValue] = useState("");
  const [inputAs, setInputAs] = useState<"native" | "mph">("native");
  const [justSaved, setJustSaved] = useState(false);

  const athlete = athletes.find((a) => a.id === athleteId);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const loggedToday = useMemo(() => {
    const s = new Set<string>();
    for (const t of tests)
      if (t.test_type === testType && t.test_date === today) s.add(t.athlete_id);
    return s;
  }, [tests, testType, today]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return athletes
      .filter((a) => athleteDisplayName(a).toLowerCase().includes(q))
      .sort((a, b) => athleteDisplayName(a).localeCompare(athleteDisplayName(b)))
      .slice(0, 8);
  }, [athletes, search]);

  const save = useMutation({
    mutationFn: async () => {
      if (!athleteId) throw new Error("Pick an athlete first");
      let val = Number(value);
      if (!val || Number.isNaN(val)) throw new Error("Enter a valid value");
      if (inputAs === "mph" && meta.unit === "s" && dist) val = mphToSeconds(val, dist);
      const organization_id = await getScopedOrgId();
      const { error } = await supabase.from("tests").insert({
        organization_id,
        athlete_id: athleteId,
        test_type: testType,
        value: val,
        unit: meta.unit,
        test_date: new Date().toISOString().slice(0, 10),
      });
      if (error) throw error;
      return val;
    },
    onSuccess: (val) => {
      qc.invalidateQueries({ queryKey: ["tests"] });
      const name = athlete ? athleteDisplayName(athlete) : "Athlete";
      setJustSaved(true);
      setTimeout(() => {
        setJustSaved(false);
        setAthleteId("");
        setValue("");
        setSearch("");
        setInputAs("native");
      }, 700);
      toast.success(`Saved — ${name}: ${val} ${meta.unit}`);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const startKiosk = () => {
    if (!testType) return;
    if (typeof window !== "undefined") window.localStorage.setItem(KIOSK_METRIC_KEY, testType);
    setSearch("");
    setAthleteId("");
    setValue("");
    setStage("active");
  };

  const exitToSetup = () => {
    setStage("setup");
    setSearch("");
    setAthleteId("");
    setValue("");
  };

  const pickMatch = (a: Athlete) => {
    setAthleteId(a.id);
    setSearch("");
  };

  const tapDigit = (d: string) => {
    if (d === "." && value.includes(".")) return;
    setValue((v) => (v + d).slice(0, 8));
  };
  const backspace = () => setValue((v) => v.slice(0, -1));

  if (stage === "setup") {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background p-4">
        <Link
          to="/tests"
          className="absolute left-4 top-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Exit kiosk
        </Link>
        <Card className="w-full max-w-md border-2">
          <CardHeader className="items-center text-center">
            <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Gauge className="h-7 w-7 text-primary" />
            </div>
            <CardTitle className="text-2xl">Start Test Kiosk</CardTitle>
            <CardDescription className="text-base">
              Pick the one metric this station will log. Athletes can only log that metric until you
              exit this kiosk.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={testType} onValueChange={setTestType}>
              <SelectTrigger className="h-14 text-lg font-semibold">
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
                          {t.label}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Button className="h-16 w-full text-xl" disabled={!testType} onClick={startKiosk}>
              Start Kiosk
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-background">
      {/* Nothing on this screen but the log-test flow — no metric banner, no
          session counter. Exiting is a coach action, not something athletes
          need in front of them, so it's a small icon tucked in the corner
          rather than a header bar competing with the actual task. */}
      <button
        type="button"
        onClick={exitToSetup}
        className="absolute left-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Exit kiosk"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>

      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm">
          {!athlete ? (
            <div>
              <div className="relative">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search your name"
                  className="h-16 pl-12 text-xl"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && matches.length === 1) pickMatch(matches[0]);
                  }}
                />
              </div>
              {matches.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {matches.map((a) => {
                    const name = athleteDisplayName(a);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => pickMatch(a)}
                        className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 text-left transition active:scale-[0.98] active:bg-muted"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                          {initialsFor(name)}
                        </div>
                        <span className="flex-1 truncate text-lg font-semibold">{name}</span>
                        {loggedToday.has(a.id) && (
                          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-[color:var(--color-success)]">
                            <Check className="h-3.5 w-3.5" /> Logged
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {search.trim() && matches.length === 0 && (
                <p className="mt-4 text-center text-sm text-muted-foreground">No matches.</p>
              )}
            </div>
          ) : justSaved ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[color:var(--color-success)]/15">
                <Check className="h-10 w-10 text-[color:var(--color-success)]" />
              </div>
              <div className="text-xl font-bold">Saved!</div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-base font-bold text-primary">
                  {initialsFor(athleteDisplayName(athlete))}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-2xl font-bold tracking-tight">
                    {athleteDisplayName(athlete)}
                  </div>
                  {loggedToday.has(athlete.id) && (
                    <div className="flex items-center gap-1 text-xs font-medium text-[color:var(--color-success)]">
                      <Check className="h-3.5 w-3.5" /> already logged today
                    </div>
                  )}
                </div>
              </div>

              {dist && meta.unit === "s" && (
                <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm">
                  <button
                    type="button"
                    className={cn(
                      "h-10 rounded font-medium transition",
                      inputAs === "native" ? "bg-background shadow-sm" : "text-muted-foreground",
                    )}
                    onClick={() => setInputAs("native")}
                  >
                    Seconds
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "h-10 rounded font-medium transition",
                      inputAs === "mph" ? "bg-background shadow-sm" : "text-muted-foreground",
                    )}
                    onClick={() => setInputAs("mph")}
                  >
                    MPH
                  </button>
                </div>
              )}

              <div className="rounded-2xl border-2 border-border/60 bg-card p-4 text-center">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {meta.label} {inputAs === "mph" ? "(mph)" : meta.unit ? `(${meta.unit})` : ""}
                </div>
                <div className="font-mono text-6xl font-bold tabular-nums">{value || "0"}</div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => tapDigit(d)}
                    className="h-16 rounded-xl border border-border/60 bg-card text-2xl font-bold transition active:scale-95 active:bg-muted"
                  >
                    {d}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={backspace}
                  className="flex h-16 items-center justify-center rounded-xl border border-border/60 bg-card transition active:scale-95 active:bg-muted"
                  aria-label="Backspace"
                >
                  <Delete className="h-6 w-6" />
                </button>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="h-16"
                  onClick={() => {
                    setAthleteId("");
                    setValue("");
                  }}
                >
                  ← Back
                </Button>
                <Button
                  className="h-16 flex-1 text-xl"
                  disabled={save.isPending || !value.trim()}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? "Saving…" : "Save & Next"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
