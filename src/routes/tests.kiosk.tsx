// A walk-up station for max-testing days. A coach first locks the station to
// one metric — that's all it can log until someone exits back to setup — then
// hands the device to athletes. Each athlete just types their name into one
// centered search box, taps the match, and enters their number. No roster
// grid, no per-athlete sign-in: the coach's own session is what's
// authenticated here.
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
  type CustomMetric,
} from "@/lib/queries";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import {
  TEST_TYPES,
  testTypeMeta as baseTestTypeMeta,
  sprintDistanceIn,
  mphToSeconds,
  customMetricTestTypeValue,
} from "@/lib/domain";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { toast } from "sonner";
import { ArrowLeft, Check, CheckCircle2, Gauge, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tests/kiosk")({
  head: () => ({
    meta: [{ title: "Test Kiosk — Strength Lab" }, { name: "robots", content: "noindex" }],
  }),
  component: TestKioskPage,
});

const KIOSK_METRIC_KEY = "sl.testKiosk.metric";

type TypeOpt = {
  value: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  group: string;
};

function TestKioskPage() {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: tests = [] } = useQuery(testsQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const { data: customMetrics = [] } = useQuery(customMetricsQO);

  // Same test-type merge as the main Tests page: built-ins + org-defined
  // test types + Custom Metrics page entries, deduped by value.
  const allTestTypes = useMemo(() => {
    const base: TypeOpt[] = TEST_TYPES.map((t) => ({
      value: t.value as string,
      label: t.label as string,
      unit: t.unit as string,
      lowerIsBetter: t.lowerIsBetter,
      group: t.group as string,
    }));
    const custom: TypeOpt[] = customTypes.map((c) => ({
      value: c.value,
      label: c.label,
      unit: c.unit,
      lowerIsBetter: c.lower_is_better,
      group: c.group_name,
    }));
    const metricUnit = (m: CustomMetric) =>
      m.unit ||
      (m.measurement === "time"
        ? "s"
        : m.measurement === "height"
          ? "in"
          : m.measurement === "speed"
            ? "mph"
            : "lb");
    const fromMetrics: TypeOpt[] = customMetrics.map((m: CustomMetric) => ({
      value: customMetricTestTypeValue(m),
      label: m.name,
      unit: metricUnit(m),
      lowerIsBetter: m.lower_is_better,
      group: "Metrics",
    }));
    const seen = new Set(base.map((t) => t.value));
    const merged = [...base];
    for (const t of [...custom, ...fromMetrics]) {
      if (seen.has(t.value)) continue;
      seen.add(t.value);
      merged.push(t);
    }
    return merged;
  }, [customTypes, customMetrics]);

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
  const [sessionLog, setSessionLog] = useState<{ id: string; name: string; display: string }[]>([]);

  const athlete = athletes.find((a) => a.id === athleteId);
  const step = meta.unit === "s" ? "0.01" : meta.unit === "in" ? "0.1" : "1";

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
      toast.success(`Saved — ${name}: ${val} ${meta.unit}`);
      setSessionLog((prev) =>
        [
          { id: `${Date.now()}-${Math.random()}`, name, display: `${val} ${meta.unit}` },
          ...prev,
        ].slice(0, 8),
      );
      setAthleteId("");
      setValue("");
      setSearch("");
      setInputAs("native");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const startKiosk = () => {
    if (!testType) return;
    if (typeof window !== "undefined") window.localStorage.setItem(KIOSK_METRIC_KEY, testType);
    setSessionLog([]);
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

  if (stage === "setup") {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background p-4">
        <Link
          to="/tests"
          className="absolute left-4 top-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Exit kiosk
        </Link>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Gauge className="h-4 w-4 text-primary" /> Start Test Kiosk
            </CardTitle>
            <CardDescription>
              Pick the one metric this station will log. Athletes can only log that metric until you
              exit this kiosk.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={testType} onValueChange={setTestType}>
              <SelectTrigger className="h-11 text-base font-semibold">
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
            <Button className="h-12 w-full text-base" disabled={!testType} onClick={startKiosk}>
              Start Kiosk
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <button
          type="button"
          onClick={exitToSetup}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Change metric
        </button>
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Gauge className="h-4 w-4 text-primary" /> {meta.label}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-6">
        <Card>
          <CardContent className="p-6">
            {!athlete ? (
              <div>
                <Label className="text-xs text-muted-foreground">Search athlete name</Label>
                <div className="relative mt-1.5">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Type a name…"
                    className="h-12 pl-9 text-base"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && matches.length === 1) pickMatch(matches[0]);
                    }}
                  />
                </div>
                {matches.length > 0 && (
                  <div className="mt-2 divide-y overflow-hidden rounded-md border">
                    {matches.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => pickMatch(a)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/60 active:bg-muted"
                      >
                        <span className="font-medium">{athleteDisplayName(a)}</span>
                        {loggedToday.has(a.id) && (
                          <span className="flex items-center gap-1 text-[11px] text-[color:var(--color-success)]">
                            <Check className="h-3 w-3" /> Logged
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {search.trim() && matches.length === 0 && (
                  <p className="mt-3 text-center text-sm text-muted-foreground">No matches.</p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground">Logging for</div>
                  <div className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                    {athleteDisplayName(athlete)}
                    {loggedToday.has(athlete.id) && (
                      <span className="flex items-center gap-1 text-xs font-normal text-[color:var(--color-success)]">
                        <Check className="h-3.5 w-3.5" /> already logged today
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {meta.label} {inputAs === "mph" ? "(mph)" : meta.unit ? `(${meta.unit})` : ""}
                  </Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step={step}
                    autoFocus
                    className="h-16 text-center text-3xl font-bold"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="0"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && value.trim() && !save.isPending) save.mutate();
                    }}
                  />
                </div>
                {dist && meta.unit === "s" && (
                  <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm">
                    <button
                      type="button"
                      className={cn(
                        "h-9 rounded font-medium transition",
                        inputAs === "native" ? "bg-background shadow-sm" : "text-muted-foreground",
                      )}
                      onClick={() => setInputAs("native")}
                    >
                      Seconds
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "h-9 rounded font-medium transition",
                        inputAs === "mph" ? "bg-background shadow-sm" : "text-muted-foreground",
                      )}
                      onClick={() => setInputAs("mph")}
                    >
                      MPH
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="h-14"
                    onClick={() => {
                      setAthleteId("");
                      setValue("");
                    }}
                  >
                    ← Back
                  </Button>
                  <Button
                    className="h-14 flex-1 text-lg"
                    disabled={save.isPending || !value.trim()}
                    onClick={() => save.mutate()}
                  >
                    {save.isPending ? "Saving…" : "Save & Next"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {sessionLog.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">
                Logged this session · {sessionLog.length}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {sessionLog.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {s.name}
                  </span>
                  <span className="mono-number font-medium">{s.display}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
