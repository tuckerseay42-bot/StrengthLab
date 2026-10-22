// A walk-up station for max-testing days: one rectangle with exactly three
// things on it — pick the athlete, pick the metric, enter the score — and a
// button to log it. No setup step, no lock-to-one-metric flow: just the
// form, reused for the next athlete.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { athletesQO, testTypesQO, customMetricsQO } from "@/lib/queries";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import { mergedTestTypes } from "@/lib/domain";
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
import { AthleteCombobox } from "@/components/athlete-combobox";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/tests/kiosk")({
  head: () => ({
    meta: [{ title: "Test Kiosk — Strength Lab" }, { name: "robots", content: "noindex" }],
  }),
  component: TestKioskPage,
});

const KIOSK_METRIC_KEY = "sl.testKiosk.metric";

function TestKioskPage() {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const { data: customMetrics = [] } = useQuery(customMetricsQO);

  const allTestTypes = useMemo(
    () => mergedTestTypes(customTypes, customMetrics),
    [customTypes, customMetrics],
  );
  const groups = useMemo(
    () => Array.from(new Set(allTestTypes.map((t) => t.group))),
    [allTestTypes],
  );

  const [testType, setTestType] = useState(
    () =>
      (typeof window !== "undefined" ? window.localStorage.getItem(KIOSK_METRIC_KEY) : null) ?? "",
  );
  const [athleteId, setAthleteId] = useState("");
  const [value, setValue] = useState("");

  const meta = allTestTypes.find((t) => t.value === testType);

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
      if (typeof window !== "undefined" && testType) {
        window.localStorage.setItem(KIOSK_METRIC_KEY, testType);
      }
      setAthleteId("");
      setValue("");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center bg-background p-4">
      <Link
        to="/tests"
        className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Exit kiosk"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>

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
                if (e.key === "Enter" && !save.isPending) save.mutate();
              }}
            />
          </div>
          <Button
            className="h-12 w-full text-base"
            disabled={save.isPending || !athleteId || !testType || !value.trim()}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Log test"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
