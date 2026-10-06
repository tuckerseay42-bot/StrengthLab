// A walk-up station for max-testing days: a coach picks which metric is
// being tested once, then hands the device to athletes. Each athlete taps
// their own name off a big tile grid (filterable by class period/sport so a
// single class's roster shows up, not the whole org) and enters their
// number — no per-athlete sign-in needed, since the coach's own session is
// what's authenticated here.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  athletesQO,
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
} from "@/lib/domain";
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
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Gauge, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tests/kiosk")({
  head: () => ({
    meta: [{ title: "Test Kiosk — Strength Lab" }, { name: "robots", content: "noindex" }],
  }),
  component: TestKioskPage,
});

const KIOSK_METRIC_KEY = "sl.testKiosk.metric";
const KIOSK_CLASS_PERIOD_KEY = "sl.testKiosk.classPeriod";
const KIOSK_SPORT_KEY = "sl.testKiosk.sport";

type TypeOpt = {
  value: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  group: string;
};

function readStoredFilter(key: string): string {
  if (typeof window === "undefined") return "all";
  return window.localStorage.getItem(key) ?? "all";
}

function TestKioskPage() {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
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
      m.unit || (m.measurement === "time" ? "s" : m.measurement === "height" ? "in" : "lb");
    const fromMetrics: TypeOpt[] = customMetrics.map((m: CustomMetric) => ({
      value:
        m.test_type ||
        m.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, ""),
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

  // Which metric this station is logging — sticky across reloads so the
  // coach only has to set it once per testing station.
  const [testType, setTestType] = useState("");
  useEffect(() => {
    if (testType || !allTestTypes.length) return;
    const saved =
      typeof window !== "undefined" ? window.localStorage.getItem(KIOSK_METRIC_KEY) : null;
    setTestType(
      saved && allTestTypes.some((t) => t.value === saved) ? saved : allTestTypes[0].value,
    );
  }, [allTestTypes, testType]);
  useEffect(() => {
    if (testType && typeof window !== "undefined")
      window.localStorage.setItem(KIOSK_METRIC_KEY, testType);
  }, [testType]);

  const meta = allTestTypes.find((t) => t.value === testType) ?? baseTestTypeMeta(testType);
  const dist = sprintDistanceIn(testType);

  // Roster scoping — sticky per station, same reasoning as the metric:
  // a coach running 2nd period shouldn't have to re-filter every reload.
  const [classPeriodFilter, setClassPeriodFilter] = useState(() =>
    readStoredFilter(KIOSK_CLASS_PERIOD_KEY),
  );
  const [sportFilter, setSportFilter] = useState(() => readStoredFilter(KIOSK_SPORT_KEY));
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined")
      window.localStorage.setItem(KIOSK_CLASS_PERIOD_KEY, classPeriodFilter);
  }, [classPeriodFilter]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(KIOSK_SPORT_KEY, sportFilter);
  }, [sportFilter]);

  const classPeriods = useMemo(() => {
    const s = new Set<string>();
    for (const a of athletes) if (a.class_period?.trim()) s.add(a.class_period.trim());
    return Array.from(s).sort();
  }, [athletes]);
  const sports = useMemo(() => {
    const s = new Set<string>();
    for (const a of athletes) if (a.sport?.trim()) s.add(a.sport.trim());
    return Array.from(s).sort();
  }, [athletes]);

  const roster = useMemo(() => {
    let list = athletes;
    if (classPeriodFilter !== "all")
      list = list.filter((a) => a.class_period === classPeriodFilter);
    if (sportFilter !== "all") list = list.filter((a) => a.sport === sportFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => athleteDisplayName(a).toLowerCase().includes(q));
    }
    return list.slice().sort((a, b) => athleteDisplayName(a).localeCompare(athleteDisplayName(b)));
  }, [athletes, classPeriodFilter, sportFilter, search]);

  const [athleteId, setAthleteId] = useState("");
  const [value, setValue] = useState("");
  const [inputAs, setInputAs] = useState<"native" | "mph">("native");
  const [sessionLog, setSessionLog] = useState<{ id: string; name: string; display: string }[]>([]);

  const athlete = athletes.find((a) => a.id === athleteId);
  const step = meta.unit === "s" ? "0.01" : meta.unit === "in" ? "0.1" : "1";

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
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <Link
          to="/tests"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Exit kiosk
        </Link>
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Gauge className="h-4 w-4 text-primary" /> Test Kiosk
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-3">
            <Label className="shrink-0 text-xs text-muted-foreground">Now logging</Label>
            <Select
              value={testType}
              onValueChange={(v) => {
                setTestType(v);
                setAthleteId("");
                setValue("");
                setInputAs("native");
              }}
            >
              <SelectTrigger className="h-11 min-w-[220px] flex-1 text-base font-semibold">
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
          </CardContent>
        </Card>

        {athlete ? (
          <Card className="flex-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-muted-foreground">Logging for</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-3xl font-bold tracking-tight">{athleteDisplayName(athlete)}</div>
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
            </CardContent>
          </Card>
        ) : (
          <Card className="flex flex-1 flex-col">
            <CardHeader className="gap-3 pb-3">
              <CardTitle className="text-sm text-muted-foreground">
                Tap your name — {roster.length} athlete{roster.length === 1 ? "" : "s"}
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Select value={classPeriodFilter} onValueChange={setClassPeriodFilter}>
                  <SelectTrigger className="h-9 w-[160px] text-xs">
                    <SelectValue placeholder="Class period" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All class periods</SelectItem>
                    {classPeriods.map((cp) => (
                      <SelectItem key={cp} value={cp}>
                        {cp}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sportFilter} onValueChange={setSportFilter}>
                  <SelectTrigger className="h-9 w-[150px] text-xs">
                    <SelectValue placeholder="Sport" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sports</SelectItem>
                    {sports.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative min-w-[160px] flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search…"
                    className="h-9 pl-8 text-xs"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              {roster.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No athletes match these filters.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {roster.map((a) => (
                    <NameTile key={a.id} athlete={a} onClick={() => setAthleteId(a.id)} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

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

function NameTile({ athlete, onClick }: { athlete: Athlete; onClick: () => void }) {
  const meta = [athlete.sport, athlete.class_period].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-20 flex-col items-center justify-center gap-0.5 rounded-xl border border-border/60 bg-card px-2 text-center transition active:scale-[0.97] hover:border-primary hover:bg-primary/5"
    >
      <span className="text-sm font-semibold leading-tight">{athleteDisplayName(athlete)}</span>
      {meta && <span className="truncate text-[10px] text-muted-foreground">{meta}</span>}
    </button>
  );
}
