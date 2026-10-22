// A walk-up station for max-testing days: one rectangle with exactly three
// things on it — pick the athlete, pick the metric, enter the score — and a
// button to log it. No setup step, no lock-to-one-metric flow: just the
// form, reused for the next athlete.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { athletesQO, testTypesQO, customMetricsQO, testsQO } from "@/lib/queries";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import { mergedTestTypes } from "@/lib/domain";
import { validateTestValue, implausibleJump } from "@/lib/validation";
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
  const { data: tests = [] } = useQuery(testsQO);

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
  const [confirmJump, setConfirmJump] = useState<{
    pct: number;
    priorBest: number;
    name: string;
  } | null>(null);

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
      setConfirmJump({ pct, priorBest, name });
      return;
    }
    save.mutate();
  };

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

      <AlertDialog open={!!confirmJump} onOpenChange={(v) => !v && setConfirmJump(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Double-check this score</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmJump && (
                <>
                  {confirmJump.name}'s previous best was {confirmJump.priorBest} {meta?.unit}. This
                  entry is a {Math.round(Math.abs(confirmJump.pct) * 100)}%{" "}
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
                setConfirmJump(null);
                save.mutate();
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
