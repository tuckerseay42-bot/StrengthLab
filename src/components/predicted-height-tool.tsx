import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Ruler, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import type { Athlete } from "@/lib/queries";

/*
 * Predicted adult height calculation adapted from:
 * Khamis, H.J., Roche, A.F. (1994). "Predicting adult stature without using
 * skeletal age: the Khamis-Roche method." Pediatrics, 94(4), 504-507.
 */

/**
 * Predicted adult height using a Khamis-Roche–style estimate:
 *  - Extrapolate current stature via published % of adult height by age & sex.
 *  - Blend with mid-parent target height (Tanner), weighting current-height
 *    extrapolation more heavily as the athlete ages.
 *  - Small weight-for-age adjustment (heavier for age → slightly taller adult).
 */

// % of adult height reached, by age (years) and sex. Smoothed CDC-derived.
const PCT_MALE: Record<number, number> = {
  4: 0.585, 5: 0.62, 6: 0.66, 7: 0.70, 8: 0.74, 9: 0.78, 10: 0.82,
  11: 0.85, 12: 0.88, 13: 0.912, 14: 0.948, 15: 0.976, 16: 0.99, 17: 0.995, 18: 1.0,
};
const PCT_FEMALE: Record<number, number> = {
  4: 0.62, 5: 0.665, 6: 0.71, 7: 0.755, 8: 0.795, 9: 0.83, 10: 0.875,
  11: 0.92, 12: 0.955, 13: 0.98, 14: 0.99, 15: 0.995, 16: 0.998, 17: 1.0, 18: 1.0,
};

function interp(table: Record<number, number>, age: number) {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (age <= keys[0]) return table[keys[0]];
  if (age >= keys[keys.length - 1]) return table[keys[keys.length - 1]];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (age >= a && age <= b) {
      const t = (age - a) / (b - a);
      return table[a] + (table[b] - table[a]) * t;
    }
  }
  return 1;
}

function ageInYears(dob: string, on: string) {
  const d = new Date(dob), o = new Date(on);
  if (isNaN(d.getTime()) || isNaN(o.getTime())) return null;
  const ms = o.getTime() - d.getTime();
  return ms / (365.25 * 24 * 60 * 60 * 1000);
}

export function PredictedHeightTool({ athlete }: { athlete: Athlete }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [sex, setSex] = useState<"male" | "female">(
    ((athlete.gender ?? "male").toLowerCase() === "female" ? "female" : "male"),
  );
  const [dob, setDob] = useState<string>((athlete as any).date_of_birth ?? "");
  const [assessDate, setAssessDate] = useState<string>(today);
  const [heightIn, setHeightIn] = useState<string>(
    athlete.height_in != null ? String(athlete.height_in) : "",
  );
  const [weightLb, setWeightLb] = useState<string>(
    athlete.bodyweight != null ? String(athlete.bodyweight) : "",
  );
  const [momIn, setMomIn] = useState<string>("");
  const [dadIn, setDadIn] = useState<string>("");

  const result = useMemo(() => {
    const h = Number(heightIn), w = Number(weightLb);
    const mom = Number(momIn), dad = Number(dadIn);
    const errors: string[] = [];
    if (!dob) errors.push("Date of birth is required.");
    if (!h || h <= 0) errors.push("Athlete's height must be greater than zero.");
    if (!w || w <= 0) errors.push("Athlete's weight must be greater than zero.");
    if (!mom || mom <= 0) errors.push("Mom's height must be greater than zero.");
    if (!dad || dad <= 0) errors.push("Dad's height must be greater than zero.");
    if (errors.length) return { errors };

    const age = ageInYears(dob, assessDate);
    if (age == null || age < 3 || age > 20) return { errors: ["Age must be between 3 and 20 years."] };

    const pct = interp(sex === "male" ? PCT_MALE : PCT_FEMALE, age);
    const extrapolated = h / pct;

    // Tanner mid-parent target height
    const midparent = (mom + dad) / 2 + (sex === "male" ? 2.5 : -2.5);

    // Weight extrapolation more as age rises (own trajectory dominates near maturity)
    const wAge = Math.min(0.9, Math.max(0.35, (age - 6) / 12));
    let predicted = wAge * extrapolated + (1 - wAge) * midparent;

    // Small weight-for-age nudge (±0.6 in max)
    const expectedW = 2.2 * age + 18; // very rough expected lb
    const wAdj = Math.max(-0.6, Math.min(0.6, (w - expectedW) * 0.01));
    predicted += wAdj;

    return {
      errors: [] as string[],
      age,
      pct,
      extrapolated,
      midparent,
      predicted,
    };
  }, [dob, assessDate, heightIn, weightLb, momIn, dadIn, sex]);

  const save = useMutation({
    mutationFn: async () => {
      if (result.errors.length || !("predicted" in result)) throw new Error("Fill every field");
      const organization_id = await getScopedOrgId();
      const { error } = await supabase.from("tests").insert({
        organization_id,
        athlete_id: athlete.id,
        test_type: "predicted_adult_height",
        value: Number(result.predicted!.toFixed(2)),
        unit: "in",
        test_date: assessDate,
        notes: `Khamis-Roche estimate · age ${result.age!.toFixed(2)}y · MPH ${result.midparent!.toFixed(1)}in · extrap ${result.extrapolated!.toFixed(1)}in`,
      });
      if (error) throw error;
      const currentH = Number(heightIn);
      if (currentH > 0 && currentH !== athlete.height_in) {
        const { error: hErr } = await supabase
          .from("athletes")
          .update({ height_in: currentH })
          .eq("id", athlete.id);
        if (hErr) throw hErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tests"] });
      qc.invalidateQueries({ queryKey: ["athletes"] });
      qc.invalidateQueries({ queryKey: ["athlete"] });
      toast.success("Test saved · profile height updated");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const ok = result.errors.length === 0 && "predicted" in result;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Ruler className="h-4 w-4" /> Predicted adult height
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Khamis-Roche–style estimate from your height, weight, age, and both parents' heights.
          Each completion is saved to your metrics as <span className="font-medium">Predicted Adult Height</span>.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Sex</Label>
            <select
              value={sex}
              onChange={(e) => setSex(e.target.value as "male" | "female")}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Date of birth</Label>
            <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Assessment date</Label>
            <Input type="date" value={assessDate} onChange={(e) => setAssessDate(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Athlete height (in)</Label>
            <Input inputMode="decimal" placeholder="e.g. 63" value={heightIn} onChange={(e) => setHeightIn(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Athlete weight (lb)</Label>
            <Input inputMode="decimal" placeholder="e.g. 99" value={weightLb} onChange={(e) => setWeightLb(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mom's height (in)</Label>
            <Input inputMode="decimal" placeholder="e.g. 65" value={momIn} onChange={(e) => setMomIn(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Dad's height (in)</Label>
            <Input inputMode="decimal" placeholder="e.g. 70" value={dadIn} onChange={(e) => setDadIn(e.target.value)} className="h-9" />
          </div>
        </div>

        {!ok ? (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
            <div className="font-medium mb-1">Enter every field to see the profile:</div>
            <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
              {result.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </div>
        ) : (
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-primary">{result.predicted!.toFixed(1)}</span>
              <span className="text-sm text-muted-foreground">in predicted adult height</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
              <div><div className="text-foreground font-medium">{result.age!.toFixed(1)}y</div>Age</div>
              <div><div className="text-foreground font-medium">{result.midparent!.toFixed(1)} in</div>Mid-parent</div>
              <div><div className="text-foreground font-medium">{(result.pct! * 100).toFixed(0)}%</div>Of adult stature</div>
            </div>
            <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full">
              <Check className="mr-1 h-4 w-4" />
              {save.isPending ? "Running…" : "Run Test"}
            </Button>
          </div>
        )}

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Educational estimate from a population growth model — not a medical diagnosis, guaranteed
          adult height, or injury forecast. Do not use for medical, clearance, or return-to-play
          decisions.
        </p>
      </CardContent>
    </Card>
  );
}
