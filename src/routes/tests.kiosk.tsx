// A walk-up station for max-testing days: a coach picks which metric is
// being tested once, then hands the device to athletes. Each athlete finds
// their own name and enters their number — no per-athlete sign-in needed,
// since the coach's own session is what's authenticated here.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  athletesQO, testTypesQO, customMetricsQO, athleteDisplayName, type CustomMetric,
} from "@/lib/queries";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import { TEST_TYPES, testTypeMeta as baseTestTypeMeta, sprintDistanceIn, mphToSeconds } from "@/lib/domain";
import { AthleteCombobox } from "@/components/athlete-combobox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Gauge } from "lucide-react";

export const Route = createFileRoute("/tests/kiosk")({
  head: () => ({ meta: [
    { title: "Test Kiosk — Strength Lab" },
    { name: "robots", content: "noindex" },
  ] }),
  component: TestKioskPage,
});

const KIOSK_METRIC_KEY = "sl.testKiosk.metric";

type TypeOpt = { value: string; label: string; unit: string; lowerIsBetter: boolean; group: string };

function TestKioskPage() {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const { data: customMetrics = [] } = useQuery(customMetricsQO);

  // Same test-type merge as the main Tests page: built-ins + org-defined
  // test types + Custom Metrics page entries, deduped by value.
  const allTestTypes = useMemo(() => {
    const base: TypeOpt[] = TEST_TYPES.map((t) => ({
      value: t.value as string, label: t.label as string, unit: t.unit as string,
      lowerIsBetter: t.lowerIsBetter, group: t.group as string,
    }));
    const custom: TypeOpt[] = customTypes.map((c) => ({
      value: c.value, label: c.label, unit: c.unit,
      lowerIsBetter: c.lower_is_better, group: c.group_name,
    }));
    const metricUnit = (m: CustomMetric) =>
      m.unit || (m.measurement === "time" ? "s" : m.measurement === "height" ? "in" : "lb");
    const fromMetrics: TypeOpt[] = customMetrics.map((m: CustomMetric) => ({
      value: m.test_type || m.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      label: m.name, unit: metricUnit(m), lowerIsBetter: m.lower_is_better, group: "Metrics",
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

  const groups = useMemo(() => Array.from(new Set(allTestTypes.map((t) => t.group))), [allTestTypes]);

  // Which metric this station is logging — sticky across reloads so the
  // coach only has to set it once per testing station.
  const [testType, setTestType] = useState("");
  useEffect(() => {
    if (testType || !allTestTypes.length) return;
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(KIOSK_METRIC_KEY) : null;
    setTestType(saved && allTestTypes.some((t) => t.value === saved) ? saved : allTestTypes[0].value);
  }, [allTestTypes, testType]);
  useEffect(() => {
    if (testType && typeof window !== "undefined") window.localStorage.setItem(KIOSK_METRIC_KEY, testType);
  }, [testType]);

  const meta = allTestTypes.find((t) => t.value === testType) ?? baseTestTypeMeta(testType);
  const dist = sprintDistanceIn(testType);

  const [athleteId, setAthleteId] = useState("");
  const [value, setValue] = useState("");
  const [inputAs, setInputAs] = useState<"native" | "mph">("native");
  const [sessionLog, setSessionLog] = useState<{ id: string; name: string; display: string }[]>([]);

  const athlete = athletes.find((a) => a.id === athleteId);
  const step = meta.unit === "s" ? "0.01" : meta.unit === "in" ? "0.1" : "1";

  const save = useMutation({
    mutationFn: async () => {
      if (!athleteId) throw new Error("Search for an athlete first");
      let val = Number(value);
      if (!val || Number.isNaN(val)) throw new Error("Enter a valid value");
      if (inputAs === "mph" && meta.unit === "s" && dist) val = mphToSeconds(val, dist);
      const organization_id = await getScopedOrgId();
      const { error } = await supabase.from("tests").insert({
        organization_id, athlete_id: athleteId, test_type: testType, value: val,
        unit: meta.unit, test_date: new Date().toISOString().slice(0, 10),
      });
      if (error) throw error;
      return val;
    },
    onSuccess: (val) => {
      qc.invalidateQueries({ queryKey: ["tests"] });
      const name = athlete ? athleteDisplayName(athlete) : "Athlete";
      toast.success(`Saved — ${name}: ${val} ${meta.unit}`);
      setSessionLog((prev) => [{ id: `${Date.now()}-${Math.random()}`, name, display: `${val} ${meta.unit}` }, ...prev].slice(0, 8));
      setAthleteId("");
      setValue("");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <Link to="/tests" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Exit kiosk
        </Link>
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Gauge className="h-4 w-4 text-primary" /> Test Kiosk
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-5 px-4 py-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">Now logging</CardTitle>
          </CardHeader>
          <CardContent>
            <Select
              value={testType}
              onValueChange={(v) => { setTestType(v); setAthleteId(""); setValue(""); setInputAs("native"); }}
            >
              <SelectTrigger className="h-14 text-lg font-semibold">
                <SelectValue placeholder="Choose a metric" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectGroup key={g}>
                    <SelectLabel>{g}</SelectLabel>
                    {allTestTypes.filter((t) => t.group === g).map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">Find your name</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <AthleteCombobox
              athletes={athletes}
              value={athleteId}
              onChange={setAthleteId}
              placeholder="Search your name…"
              triggerClassName="h-16 text-lg px-4"
            />

            {athleteId && (
              <div className="space-y-3">
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
                    onKeyDown={(e) => { if (e.key === "Enter" && value.trim() && !save.isPending) save.mutate(); }}
                  />
                </div>
                {dist && meta.unit === "s" && (
                  <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm">
                    <button
                      type="button"
                      className={`h-9 rounded font-medium transition ${inputAs === "native" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                      onClick={() => setInputAs("native")}
                    >
                      Seconds
                    </button>
                    <button
                      type="button"
                      className={`h-9 rounded font-medium transition ${inputAs === "mph" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                      onClick={() => setInputAs("mph")}
                    >
                      MPH
                    </button>
                  </div>
                )}
                <Button
                  className="h-14 w-full text-lg"
                  disabled={save.isPending || !value.trim()}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? "Saving…" : "Save & Next"}
                </Button>
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
