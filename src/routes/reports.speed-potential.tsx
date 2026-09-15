import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, ReferenceDot,
} from "recharts";
import {
  Copy, Download, FileText, Printer, Gauge, Ruler, Timer, Trophy, Check, Plus, Trash2,
  RotateCcw, ChevronDown, Sheet as SheetIcon, Info, ImagePlus, X,
} from "lucide-react";
import { MarketingShell, NeonCard } from "@/components/marketing-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  MAX_TOTAL_YARDS, MAX_TOTAL_METERS,
  computeSprintProfile, fortySourceLabel, confidenceLabel, profileToCsv, downloadCsv, fmt,
  type DistanceUnit, type EntryMode, type SplitRowInput, type Gender,
} from "@/lib/sprint-profile";
import { TIERS, TIER_MEANING } from "@/lib/speed-potential";
import { renderShareCard, downloadCanvasPng, downloadCanvasPdf } from "@/lib/tool-share";

export const Route = createFileRoute("/reports/speed-potential")({
  head: () => ({
    meta: [
      { title: "Free Sprint Speed Profile Report — Strength Lab Hub" },
      { name: "description", content: "Enter height, bodyweight, and sprint splits to calculate peak MPH, predicted 40-yard time, pounds per inch, and your size-adjusted speed tier. Free, no login." },
      { property: "og:title", content: "Free Sprint Speed Profile Report" },
      { property: "og:description", content: "Peak MPH, split velocities, predicted 40, and a size-adjusted speed tier — instantly, with no account." },
      { property: "og:url", content: "https://www.strengthlabhub.com/reports/speed-potential" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://www.strengthlabhub.com/reports/speed-potential" }],
  }),
  component: SprintSpeedProfilePage,
});

function num(v: string): number | null {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
}

let rowSeq = 0;
const nextId = () => `r${++rowSeq}`;

type Row = { id: string; label: string; distance: string; time: string };

const DEFAULT_SEGMENTS = [10, 10, 10, 10];

function defaultRows(unit: DistanceUnit, mode: EntryMode): Row[] {
  const unitLabel = unit === "yards" ? "yd" : "m";
  let cum = 0;
  return DEFAULT_SEGMENTS.map((seg) => {
    const from = cum;
    cum += seg;
    return {
      id: nextId(),
      label: `${from}–${cum} ${unitLabel}`,
      distance: String(mode === "segment" ? seg : cum),
      time: "",
    };
  });
}

/** Re-express existing rows when the athlete switches between segments and checkpoints. */
function convertRows(rows: Row[], to: EntryMode): Row[] {
  if (to === "cumulative") {
    let cum = 0;
    return rows.map((r) => {
      cum += num(r.distance) ?? 0;
      return { ...r, distance: String(Number(cum.toFixed(2))) };
    });
  }
  let prev = 0;
  return rows.map((r) => {
    const at = num(r.distance) ?? 0;
    const seg = Math.max(0, at - prev);
    prev = at;
    return { ...r, distance: String(Number(seg.toFixed(2))) };
  });
}

function SprintSpeedProfilePage() {
  // Step 1 — athlete
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("male");
  const [feet, setFeet] = useState("");
  const [inches, setInches] = useState("");
  const [totalInches, setTotalInches] = useState("");
  const [useTotalInches, setUseTotalInches] = useState(false);
  const [weight, setWeight] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  // Step 2 — splits
  const [unit, setUnit] = useState<DistanceUnit>("yards");
  const [entryMode, setEntryMode] = useState<EntryMode>("segment");
  const [rows, setRows] = useState<Row[]>(() => defaultRows("yards", "segment"));

  // Step 3
  const [calculated, setCalculated] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [showTiers, setShowTiers] = useState(false);
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const inputsRef = useRef<HTMLDivElement>(null);

  // Hydrate a shared link
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    if (![...p.keys()].length) return;
    if (p.get("n")) setName(p.get("n")!);
    if (p.get("g") === "female" || p.get("g") === "male") setGender(p.get("g") as Gender);
    if (p.get("h")) { setUseTotalInches(true); setTotalInches(p.get("h")!); }
    if (p.get("w")) setWeight(p.get("w")!);
    if (p.get("u") === "meters") setUnit("meters");
    if (p.get("s")) {
      setEntryMode((p.get("mode") as EntryMode) ?? "segment");
      const parsed = p.get("s")!.split(",").map((x) => x.split(":"));
      setRows(parsed.map(([d, t], i) => ({ id: nextId(), label: `Split ${i + 1}`, distance: d, time: t })));
    }
    setCalculated(true);
  }, []);

  function switchUnit(next: DistanceUnit) {
    if (next === unit) return;
    setUnit(next);
    setCalculated(false);
    const unitLabel = next === "yards" ? "yd" : "m";
    setRows((p) => p.map((r) => ({ ...r, label: r.label.replace(/\b(yd|m)\b/, unitLabel) })));
  }

  function switchMode(next: EntryMode) {
    if (next === entryMode) return;
    setRows((p) => convertRows(p, next));
    setEntryMode(next);
    setCalculated(false);
  }

  const heightIn = useMemo(() => {
    if (useTotalInches) return num(totalInches) ?? 0;
    return (num(feet) ?? 0) * 12 + (num(inches) ?? 0);
  }, [useTotalInches, totalInches, feet, inches]);

  const weightLb = num(weight) ?? 0;
  const livePpi = heightIn > 0 && weightLb > 0 ? weightLb / heightIn : null;

  const splitRows: SplitRowInput[] = useMemo(
    () => rows.map((r) => ({ id: r.id, label: r.label, distance: num(r.distance) ?? 0, time: num(r.time) })),
    [rows],
  );

  const totalEntered = useMemo(() => {
    if (entryMode === "segment") return splitRows.reduce((a, r) => a + (r.distance || 0), 0);
    return Math.max(0, ...splitRows.map((r) => r.distance || 0));
  }, [splitRows, entryMode]);

  const maxTotal = unit === "yards" ? MAX_TOTAL_YARDS : MAX_TOTAL_METERS;
  const overMax = totalEntered > maxTotal + 0.001;

  const input = useMemo(() => ({
    athleteName: name.trim() || undefined,
    heightIn,
    weightLb,
    gender,
    unit,
    entryMode,
    rows: splitRows,
    officialForty: null,
    flying: false,
    timingMethod: "gates" as const,
    startPosition: "Two-point",
    surface: "Turf",
  }), [name, heightIn, weightLb, gender, unit, entryMode, splitRows]);

  const profile = useMemo(() => (calculated ? computeSprintProfile(input) : null), [calculated, input]);

  const errors = useMemo(() => {
    const e: string[] = [];
    if (!(heightIn > 0)) e.push("Enter a height greater than zero.");
    if (!(weightLb > 0)) e.push("Enter a bodyweight greater than zero.");
    if (!splitRows.some((r) => r.time != null && r.time > 0)) e.push("Enter at least one split time.");
    if (overMax) e.push(`Total sprint distance cannot exceed ${maxTotal} ${unit}.`);
    return e;
  }, [heightIn, weightLb, splitRows, overMax, maxTotal, unit]);

  function calculate() {
    if (errors.length) { toast.error(errors[0]); return; }
    setCalculated(true);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function reset() {
    setName(""); setGender("male"); setFeet(""); setInches(""); setTotalInches(""); setWeight("");
    setPhoto(null); setCalculated(false); setEmail(""); setSaved(false);
    setRows(defaultRows(unit, entryMode));
  }

  function pickPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Choose an image file"); return; }
    if (file.size > 6 * 1024 * 1024) { toast.error("Image must be under 6 MB"); return; }
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.onerror = () => toast.error("Couldn't read that image");
    reader.readAsDataURL(file);
  }


  const chartData = useMemo(
    () => (profile?.splits ?? []).map((s) => ({
      label: s.label,
      distance: Number(s.cumulativeDistanceYards.toFixed(1)),
      mph: Number(s.speedMph.toFixed(2)),
      peak: s.isPeak,
    })),
    [profile],
  );
  const peakPoint = chartData.find((d) => d.peak);

  function shareUrl() {
    const p = new URLSearchParams();
    if (name.trim()) p.set("n", name.trim());
    if (heightIn) p.set("h", String(heightIn));
    if (weightLb) p.set("w", weight);
    p.set("g", gender);
    p.set("u", unit);
    p.set("mode", entryMode);
    const s = rows.filter((r) => num(r.time) != null).map((r) => `${r.distance}:${r.time}`).join(",");
    if (s) p.set("s", s);
    return `${window.location.origin}/reports/speed-potential?${p.toString()}`;
  }

  async function buildCard() {
    if (!profile) return null;
    return renderShareCard({
      tierKey: profile.tier.key,
      tierLabel: profile.tier.label,
      tierMeaning: TIER_MEANING[profile.tier.key],
      athleteName: name.trim() || undefined,
      peakMph: profile.peakMph,
      ppi: profile.ppi,
      forty: profile.fortySeconds ? `${profile.fortySeconds.toFixed(2)}s` : "N/A",
      fortyLabel: fortySourceLabel(profile.fortySource),
      photoUrl: photo,
    });
  }

  async function downloadImage() {
    try {
      const c = await buildCard();
      if (!c) return;
      downloadCanvasPng(c, `sprint-speed-profile${name.trim() ? `-${name.trim().replace(/\s+/g, "-").toLowerCase()}` : ""}.png`);
      toast.success("Image downloaded");
    } catch {
      toast.error("Couldn't build the image");
    }
  }

  async function downloadPdf() {
    try {
      const c = await buildCard();
      if (!c) return;
      await downloadCanvasPdf(c, "sprint-speed-profile.pdf");
      toast.success("PDF downloaded");
    } catch {
      toast.error("Couldn't build the PDF");
    }
  }


  async function saveEmail() {
    if (!profile) return;
    const e = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 255) {
      toast.error("Enter a valid email address");
      return;
    }
    const { error } = await supabase.from("tool_leads").insert({
      email: e,
      tool: "sprint_speed_profile",
      results: {
        name: name.trim() || null,
        tier: profile.tier.label,
        score: profile.displayScore,
        peak_mph: Number(profile.peakMph.toFixed(2)),
        ppi: Number(profile.ppi.toFixed(2)),
        forty: profile.fortySeconds ? Number(profile.fortySeconds.toFixed(2)) : null,
        forty_source: profile.fortySource,
        distance_unit: unit,
        height_in: profile.heightIn,
        weight_lb: profile.weightLb,
        gender: profile.gender,
      },
    });
    if (error) { toast.error("Couldn't save right now — your results are still on screen."); return; }
    setSaved(true);
    toast.success("Results saved. We'll send a copy to your inbox.");
  }

  const unitLabel = unit === "yards" ? "yd" : "m";

  return (
    <MarketingShell>
      {/* HERO */}
      <section className="mx-auto max-w-6xl px-4 pt-12 pb-6 sm:pt-16">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-[0.2em] text-[color:oklch(0.72_0.18_255)]">Free tool</div>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">Sprint Speed Profile</h1>
          <p className="mt-4 text-muted-foreground">
            Enter your height, bodyweight, and sprint times to calculate peak MPH, predicted 40-yard speed, and your
            size-adjusted speed tier. No account required.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => inputsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow-[0_0_28px_-6px_oklch(0.62_0.19_255/0.9)] hover:opacity-90"
            >
              Calculate My Speed Profile
            </button>
            <button
              type="button"
              onClick={() => setShowHow((v) => !v)}
              className="inline-flex h-11 items-center gap-2 rounded-md border border-white/15 bg-white/[0.04] px-6 text-sm font-medium hover:border-white/30"
            >
              How It Works <ChevronDown className={cn("h-4 w-4 transition-transform", showHow && "rotate-180")} />
            </button>
          </div>
          {showHow && (
            <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-muted-foreground">
              Enter your split distances and times in yards or meters, and the calculator converts each segment into
              velocity, MPH, and KPH. Your fastest segment becomes peak speed, your 40 is taken from the splits when
              available, and peak speed is compared to your pounds per inch to produce a size-adjusted speed tier.
            </div>
          )}
        </div>
      </section>

      <section ref={inputsRef} className="mx-auto grid max-w-6xl gap-6 px-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        {/* ------- INPUTS ------- */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {/* STEP 1 */}
          <NeonCard>
            <StepHead n={1} icon={Ruler} title="Athlete Information" />
            <div className="mt-4 space-y-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Name (optional)</Label>
                <Input className="mt-1.5 h-12 text-base" placeholder="For your report" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Gender</Label>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {(["male", "female"] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => { setGender(g); setCalculated(false); }}
                      aria-pressed={gender === g}
                      className={`h-12 rounded-md border text-sm font-medium capitalize transition-colors ${
                        gender === g
                          ? "border-[color:oklch(0.78_0.16_255)] bg-[color:oklch(0.78_0.16_255)]/12 text-foreground"
                          : "border-white/12 bg-white/[0.03] text-muted-foreground hover:border-white/30"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Speed tiers are scored against gender-specific peak-speed norms.
                </p>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Height</Label>
                  <button type="button" onClick={() => setUseTotalInches((v) => !v)} className="text-[11px] text-[color:oklch(0.78_0.16_255)] hover:underline">
                    {useTotalInches ? "Use feet / inches" : "Use total inches"}
                  </button>
                </div>
                {useTotalInches ? (
                  <Input className="mt-1.5 h-12 text-base" inputMode="decimal" placeholder="Total inches (e.g. 71)" value={totalInches} onChange={(e) => setTotalInches(e.target.value)} />
                ) : (
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <Input className="h-12 text-base" inputMode="numeric" placeholder="Feet" value={feet} onChange={(e) => setFeet(e.target.value)} />
                    <Input className="h-12 text-base" inputMode="decimal" placeholder="Inches" value={inches} onChange={(e) => setInches(e.target.value)} />
                  </div>
                )}
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Bodyweight (lbs)</Label>
                <Input className="mt-1.5 h-12 text-base" inputMode="decimal" placeholder="e.g. 187" value={weight} onChange={(e) => setWeight(e.target.value)} />
              </div>

              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Photo (optional)</Label>
                <input
                  ref={photoRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }}
                />
                <div className="mt-1.5 flex items-center gap-3">
                  {photo ? (
                    <img src={photo} alt="Athlete preview" className="h-14 w-14 rounded-full border border-white/20 object-cover" />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-white/20 text-muted-foreground">
                      <ImagePlus className="h-5 w-5" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => photoRef.current?.click()}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-white/12 bg-white/[0.04] px-3 text-xs font-medium hover:border-white/30"
                  >
                    <ImagePlus className="h-3.5 w-3.5" /> {photo ? "Change photo" : "Add photo"}
                  </button>
                  {photo && (
                    <button
                      type="button"
                      onClick={() => setPhoto(null)}
                      aria-label="Remove photo"
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/12 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Used only on your downloaded report card. It stays on your device and is never uploaded.
                </p>
              </div>
              {livePpi != null && (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Pounds per inch</span>{" "}
                  <span className="ml-1 font-display text-lg font-bold tabular-nums">{livePpi.toFixed(2)}</span>
                </div>
              )}
            </div>
          </NeonCard>

          {/* STEP 2 — SPLITS */}
          <NeonCard>
            <StepHead n={2} icon={Timer} title="Sprint Splits" />
            <div className="mt-4 space-y-4">
              <Field label="Distance unit">
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-1">
                  {([["yards", "Yards"], ["meters", "Meters"]] as const).map(([v, l]) => (
                    <button
                      key={v} type="button" onClick={() => switchUnit(v)}
                      className={cn("h-10 rounded-md text-sm font-medium transition-colors",
                        unit === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="How times were recorded">
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-1">
                  {([["segment", "Segments"], ["cumulative", "Checkpoints"]] as const).map(([v, l]) => (
                    <button
                      key={v} type="button" onClick={() => switchMode(v)}
                      className={cn("h-10 rounded-md text-sm font-medium transition-colors",
                        entryMode === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {entryMode === "segment"
                    ? "Segments: each row is the time for that piece of the run."
                    : "Checkpoints: each row is the total elapsed time at that distance."}
                </p>
              </Field>

              <div className="space-y-3">
                <div className="grid grid-cols-[minmax(0,1fr)_84px_92px_36px] gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <div>Split</div>
                  <div>{entryMode === "segment" ? `Dist (${unitLabel})` : `At (${unitLabel})`}</div>
                  <div>{entryMode === "segment" ? "Time (s)" : "Elapsed (s)"}</div>
                  <div />
                </div>
                {rows.map((r) => (
                  <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_84px_92px_36px] items-center gap-2">
                    <Input
                      className="h-11 text-sm" value={r.label}
                      onChange={(e) => setRows((p) => p.map((x) => x.id === r.id ? { ...x, label: e.target.value } : x))}
                    />
                    <Input
                      className="h-11 text-sm" inputMode="decimal" value={r.distance}
                      onChange={(e) => { setCalculated(false); setRows((p) => p.map((x) => x.id === r.id ? { ...x, distance: e.target.value } : x)); }}
                    />
                    <Input
                      className="h-11 text-base" inputMode="decimal" placeholder="0.00" value={r.time}
                      onChange={(e) => { setCalculated(false); setRows((p) => p.map((x) => x.id === r.id ? { ...x, time: e.target.value } : x)); }}
                    />
                    <button
                      type="button" aria-label={`Remove ${r.label}`}
                      disabled={rows.length <= 1}
                      onClick={() => { setCalculated(false); setRows((p) => p.filter((x) => x.id !== r.id)); }}
                      className="inline-flex h-11 w-9 items-center justify-center rounded-md border border-white/10 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {overMax && (
                  <p className="text-[11px] text-[color:oklch(0.72_0.17_35)]">
                    Total sprint distance cannot exceed {maxTotal} {unit}.
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <SmallBtn icon={Plus} label="Add split" onClick={() => {
                    setCalculated(false);
                    setRows((p) => [...p, { id: nextId(), label: `Split ${p.length + 1}`, distance: "10", time: "" }]);
                  }} />
                  <SmallBtn icon={RotateCcw} label="Reset splits" onClick={() => { setCalculated(false); setRows(defaultRows(unit, entryMode)); }} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Rename any split and edit its distance. Distances are in {unit}.
                </p>
              </div>
            </div>
          </NeonCard>


          {/* STEP 4 */}
          <div className="hidden gap-2 lg:flex">
            <button
              type="button" onClick={calculate}
              className="inline-flex h-12 flex-1 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow-[0_0_28px_-6px_oklch(0.62_0.19_255/0.9)] hover:opacity-90"
            >
              Calculate Speed Profile
            </button>
            <button type="button" onClick={reset} className="inline-flex h-12 items-center justify-center rounded-md border border-white/15 bg-white/[0.04] px-5 text-sm font-medium hover:border-white/30">
              Reset
            </button>
          </div>
        </div>

        {/* ------- RESULTS ------- */}
        <div ref={resultsRef} className="space-y-6 pb-28 lg:pb-0">
          {!profile ? (
            <NeonCard className="flex min-h-[280px] flex-col items-center justify-center text-center">
              <Gauge className="h-10 w-10 text-muted-foreground" />
              <div className="mt-4 font-display text-xl font-semibold">Your sprint results appear here</div>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Add your height, bodyweight, and sprint times, then select Calculate Speed Profile. Nothing is stored
                unless you choose to save it.
              </p>
            </NeonCard>
          ) : (
            <>
              {/* PRIMARY */}
              <NeonCard className="overflow-hidden">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 shrink-0 items-center gap-4">
                    {photo && (
                      <img
                        src={photo}
                        alt={name.trim() ? `${name.trim()} headshot` : "Athlete photo"}
                        className="h-20 w-20 shrink-0 rounded-full border border-white/20 object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      {name.trim() && <div className="text-sm text-muted-foreground">{name.trim()}</div>}
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Speed tier</div>
                      <div
                        className="mt-1 whitespace-nowrap font-display text-4xl font-black leading-none tracking-tight sm:text-5xl"
                        style={{ color: profile.tier.color, textShadow: `0 0 40px ${profile.tier.color}55` }}
                      >
                        {profile.tier.label.toUpperCase()}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                        <span className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs uppercase tracking-wider text-muted-foreground">
                          {TIER_MEANING[profile.tier.key]}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowTiers((v) => !v)}
                          className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-[color:oklch(0.78_0.16_255)] hover:underline"
                        >
                          <Info className="h-3.5 w-3.5" /> What do the tiers mean?
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid w-full min-w-0 grid-cols-2 gap-2 lg:w-auto">

                    <Stat label="Peak MPH" value={fmt(profile.peakMph)} hint={profile.peakEstimated ? "estimated" : "fastest split"} />
                    <Stat
                      label={fortySourceLabel(profile.fortySource)}
                      value={profile.fortySeconds ? `${profile.fortySeconds.toFixed(2)}s` : "N/A"}
                      hint={
                        profile.fortySource === "entered"
                          ? "as entered"
                          : profile.splits.length
                            ? `${confidenceLabel(profile.fortyConfidence)} · from ${profile.timedDistanceYards.toFixed(1)} yd timed`
                            : confidenceLabel(profile.fortyConfidence)
                      }
                    />

                  </div>
                </div>
                <p className="mt-6 border-t border-white/10 pt-4 text-sm text-muted-foreground">{profile.tier.comparison}</p>
                {(profile.fortySource === "modeled" || profile.fortySource === "interpolated") && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Predicted 40-yard time is modeled from {profile.timedDistanceYards.toFixed(1)} yd of timed sprinting
                    {profile.timedDistanceYards < 40
                      ? ` — the remaining ${(40 - profile.timedDistanceYards).toFixed(1)} yd are estimated`
                      : ""}
                    . It is an estimate and should not be treated as an official result.
                  </p>
                )}

              </NeonCard>

              {/* SECONDARY */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Stat big label="Pounds per inch" value={fmt(profile.ppi)} hint="Bodyweight ÷ height in inches" />
                <Stat big label="Peak velocity" value={fmt(profile.peakVelocityMs, 2, " m/s")} hint={profile.peakSplit ? profile.peakSplit.label : "estimated"} />
                <Stat big label="Best split" value={profile.peakSplit ? `${profile.peakSplit.speedMph.toFixed(2)} mph` : "N/A"} hint={profile.peakSplit?.label ?? "add splits"} />
                <Stat big label="Average MPH" value={profile.splits.length ? fmt(profile.averageMph) : "N/A"} hint="Total distance ÷ total time" />
                
                <Stat big label="Final split MPH" value={profile.finalSplitMph != null ? fmt(profile.finalSplitMph) : "N/A"} hint="Last timed segment" />
                {profile.post40Maintenance != null && (
                  <Stat big label="Post-40 speed maintenance" value={fmt(profile.post40Maintenance, 1, "%")} hint={profile.bestPost40Mph != null ? `Best post-40 ${profile.bestPost40Mph.toFixed(2)} mph` : undefined} />
                )}
              </div>

              {/* TIER LEGEND */}
              {showTiers && (
                <NeonCard>
                  <div className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Speed tiers</div>
                  <div className="mt-3 space-y-2">
                    {TIERS.map((t) => (
                      <div
                        key={t.key}
                        className={cn(
                          "rounded-lg border border-white/10 bg-white/[0.03] p-3",
                          t.key === profile.tier.key && "border-primary/40",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-display text-base font-bold" style={{ color: t.color }}>
                            {t.label.toUpperCase()}
                          </span>
                          <span className="text-xs uppercase tracking-wider text-muted-foreground">{TIER_MEANING[t.key]}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{t.comparison}</p>
                      </div>
                    ))}
                  </div>
                </NeonCard>
              )}


              {/* SPLIT TABLE */}
              {profile.splits.length > 0 && (
                <NeonCard>
                  <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    <Timer className="h-4 w-4" /> Split analysis
                  </div>
                  {/* mobile cards */}
                  <div className="mt-4 space-y-2 sm:hidden">
                    {profile.splits.map((s) => (
                      <div key={s.id} className={cn("rounded-lg border border-white/10 bg-white/[0.03] p-3", s.isPeak && "border-primary/40 bg-[color:oklch(0.72_0.18_255/0.12)]")}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{s.label}</span>
                          <span className="font-mono">{s.speedMph.toFixed(2)} mph</span>
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-x-3 text-[11px] text-muted-foreground">
                          <span>Time {s.segmentTimeSeconds.toFixed(2)}s</span>
                          <span>{s.velocityMs.toFixed(2)} m/s</span>
                          <span>{s.cumulativeTimeSeconds == null ? "Cum —" : `Cum ${s.cumulativeTimeSeconds.toFixed(2)}s`}</span>
                          <span>{s.percentOfPeakSpeed.toFixed(1)}% of peak</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* desktop table */}
                  <div className="-mx-2 mt-4 hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[880px] text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-2 py-2">Split</th>
                          <th className="px-2 py-2">Dist</th>
                          <th className="px-2 py-2">Time</th>
                          <th className="px-2 py-2">Cum dist</th>
                          <th className="px-2 py-2">Cum time</th>
                          <th className="px-2 py-2">m/s</th>
                          <th className="px-2 py-2">MPH</th>
                          <th className="px-2 py-2">KPH</th>
                          <th className="px-2 py-2">% peak</th>
                          <th className="px-2 py-2">Δ vel</th>
                          <th className="px-2 py-2">Est. accel</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.splits.map((s) => (
                          <tr key={s.id} className={cn("border-t border-white/5",
                            s.isPeak && "bg-[color:oklch(0.72_0.18_255/0.12)]",
                            s.isPost40 && !s.isPeak && "bg-white/[0.03]",
                            s.flagged && "bg-[color:oklch(0.72_0.17_35/0.14)]")}>
                            <td className="px-2 py-2.5 font-medium">
                              {s.label}
                              {s.isPeak && <span className="ml-2 rounded-full border border-primary/50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[color:oklch(0.8_0.16_255)]">Peak</span>}
                              {Math.abs(s.cumulativeDistanceYards - 40) < 0.05 && <span className="ml-2 rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">40 yd</span>}
                            </td>
                            <td className="px-2 py-2.5 font-mono">{s.segmentDistanceYards.toFixed(1)} yd</td>
                            <td className="px-2 py-2.5 font-mono">{s.segmentTimeSeconds.toFixed(2)}s</td>
                            <td className="px-2 py-2.5 font-mono text-muted-foreground">{s.cumulativeDistanceYards.toFixed(1)} yd</td>
                            <td className="px-2 py-2.5 font-mono text-muted-foreground">{s.cumulativeTimeSeconds == null ? "—" : `${s.cumulativeTimeSeconds.toFixed(2)}s`}</td>
                            <td className="px-2 py-2.5 font-mono">{s.velocityMs.toFixed(2)}</td>
                            <td className="px-2 py-2.5 font-mono">{s.speedMph.toFixed(2)}</td>
                            <td className="px-2 py-2.5 font-mono text-muted-foreground">{s.speedKph.toFixed(2)}</td>
                            <td className="px-2 py-2.5 font-mono text-muted-foreground">{s.percentOfPeakSpeed.toFixed(1)}%</td>
                            <td className="px-2 py-2.5 font-mono text-muted-foreground">{s.changeInVelocityMs == null ? "—" : `${s.changeInVelocityMs > 0 ? "+" : ""}${s.changeInVelocityMs.toFixed(2)}`}</td>
                            <td className="px-2 py-2.5 font-mono text-muted-foreground">{s.estimatedAccelerationMs2 == null ? "—" : s.estimatedAccelerationMs2.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Estimated segment acceleration is a segment-based estimate calculated from average split
                    velocities. It is not an instantaneous acceleration measurement.
                  </p>
                </NeonCard>
              )}

              {/* CHART */}
              <NeonCard>
                <div className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Speed development</div>
                {chartData.length > 1 ? (
                  <div className="mt-4 h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: -12 }}>
                        <CartesianGrid stroke="oklch(0.9 0.02 255 / 0.08)" vertical={false} />
                        <XAxis dataKey="distance" tickLine={false} axisLine={false} unit=" yd" stroke="currentColor" className="text-muted-foreground" fontSize={12} />
                        <YAxis tickLine={false} axisLine={false} stroke="currentColor" className="text-muted-foreground" fontSize={12} domain={["dataMin - 2", "dataMax + 1"]} />
                        <RTooltip
                          contentStyle={{ background: "oklch(0.18 0.02 260)", border: "1px solid oklch(0.9 0.02 255 / 0.15)", borderRadius: 10, fontSize: 12 }}
                          formatter={(v: number) => [`${v} mph`, "Speed"]}
                          labelFormatter={(l) => `${l} yd`}
                        />
                        <Line type="monotone" dataKey="mph" stroke="oklch(0.72 0.19 255)" strokeWidth={3} dot={{ r: 4, fill: "oklch(0.72 0.19 255)" }} activeDot={{ r: 6 }} />
                        {peakPoint && <ReferenceDot x={peakPoint.distance} y={peakPoint.mph} r={7} fill="oklch(0.86 0.11 210)" stroke="none" />}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Add sprint splits to view speed development across the sprint.
                  </p>
                )}
              </NeonCard>

              {/* REVIEW */}
              {profile.notes.length > 0 && (
                <NeonCard>
                  <div className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Review your splits</div>
                  <ul className="mt-4 space-y-2 text-sm">
                    {profile.notes.map((n, i) => (
                      <li key={i} className="flex gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                        <span className={cn("mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
                          n.kind === "review" && "border-[color:oklch(0.72_0.17_35/0.6)] text-[color:oklch(0.78_0.15_45)]",
                          n.kind === "timing" && "border-white/20 text-muted-foreground",
                          n.kind === "data" && "border-white/20 text-muted-foreground",
                          n.kind === "observation" && "border-primary/40 text-[color:oklch(0.8_0.16_255)]")}>
                          {n.kind === "review" ? "Review" : n.kind === "timing" ? "Timing" : n.kind === "data" ? "Data note" : "Observation"}
                        </span>
                        <span className="text-muted-foreground">{n.message}</span>
                      </li>
                    ))}
                  </ul>
                </NeonCard>
              )}




              {/* DOWNLOAD / SHARE */}
              <NeonCard>
                <div className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Download results</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ShareBtn icon={Copy} label="Copy link" onClick={async () => {
                    try { await navigator.clipboard.writeText(shareUrl()); toast.success("Link copied"); }
                    catch { toast.error("Couldn't copy the link"); }
                  }} />
                  <ShareBtn icon={Copy} label="Copy summary" onClick={async () => {
                    const lines = [
                      name.trim() ? `${name.trim()} — Sprint Speed Profile` : "Sprint Speed Profile",
                      `${profile.tier.label.toUpperCase()} · ${TIER_MEANING[profile.tier.key]}`,
                      `Peak MPH: ${profile.peakMph.toFixed(2)}`,
                      `Pounds per inch: ${profile.ppi.toFixed(2)}`,
                      `${fortySourceLabel(profile.fortySource)}: ${profile.fortySeconds ? profile.fortySeconds.toFixed(2) : "N/A"}`,
                      "Generated by Strength Lab Hub",
                    ].join("\n");
                    try { await navigator.clipboard.writeText(lines); toast.success("Summary copied"); }
                    catch { toast.error("Couldn't copy the summary"); }
                  }} />
                  <ShareBtn icon={Download} label="Download image" onClick={downloadImage} />
                  <ShareBtn icon={FileText} label="Download PDF" onClick={downloadPdf} />
                  <ShareBtn icon={SheetIcon} label="Download CSV" onClick={() => downloadCsv(profileToCsv(input, profile), "sprint-speed-profile.csv")} />
                  <ShareBtn icon={Printer} label="Print" onClick={() => window.print()} />
                </div>
              </NeonCard>

              {/* OPTIONAL EMAIL */}
              <NeonCard>
                <div className="font-display text-lg font-semibold">Want a copy of your results?</div>
                <p className="mt-1 text-sm text-muted-foreground">Optional — the calculator works without it.</p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Input type="email" placeholder="Email address" value={email} onChange={(e) => { setEmail(e.target.value); setSaved(false); }} className="h-12 text-base sm:max-w-sm" />
                  <button type="button" onClick={saveEmail} disabled={saved}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow-[0_0_24px_-6px_oklch(0.62_0.19_255/0.9)] hover:opacity-90 disabled:opacity-60">
                    {saved ? <><Check className="h-4 w-4" /> Saved</> : "Email my results"}
                  </button>
                </div>
              </NeonCard>
            </>
          )}
        </div>
      </section>

      {/* STICKY MOBILE ACTIONS */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden print:hidden">
        <div className="mx-auto flex max-w-6xl gap-2">
          {profile ? (
            <>
              <button type="button" onClick={() => inputsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="inline-flex h-12 flex-1 items-center justify-center rounded-md border border-white/15 bg-white/[0.04] text-sm font-medium">
                Edit inputs
              </button>
              <button type="button" onClick={downloadImage}
                className="inline-flex h-12 flex-1 items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground">
                Download
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={reset}
                className="inline-flex h-12 items-center justify-center rounded-md border border-white/15 bg-white/[0.04] px-5 text-sm font-medium">
                Reset
              </button>
              <button type="button" onClick={calculate}
                className="inline-flex h-12 flex-1 items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground">
                Calculate
              </button>
            </>
          )}
        </div>
      </div>

      {/* LEAD GEN */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <NeonCard className="text-center">
          <Trophy className="mx-auto h-7 w-7 text-[color:oklch(0.82_0.15_85)]" />
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight">Track this over a full season</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
            Strength Lab Performance OS keeps sprint testing, weight room progress, and team reporting in one place.
          </p>
          <div className="mx-auto mt-6 flex max-w-3xl flex-wrap justify-center gap-2">
            {["Sprint progress", "Team leaderboards", "Strength numbers", "Jump testing", "Training sessions", "Performance reports"].map((f) => (
              <span key={f} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-muted-foreground">{f}</span>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/features" className="inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow-[0_0_28px_-6px_oklch(0.62_0.19_255/0.9)] hover:opacity-90">
              View platform
            </Link>
            <Link to="/pricing" className="inline-flex h-11 items-center rounded-md border border-white/15 bg-white/[0.04] px-6 text-sm font-medium hover:border-white/30">
              Request a demo
            </Link>
          </div>
        </NeonCard>
      </section>
    </MarketingShell>
  );
}

function StepHead({ n, icon: Icon, title }: { n: number; icon: typeof Ruler; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-primary/40 text-[11px] text-[color:oklch(0.8_0.16_255)]">{n}</span>
      <Icon className="h-4 w-4" /> {title}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-12 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 text-sm text-foreground outline-none focus:border-primary/60"
    >
      {children}
    </select>
  );
}



function Stat({ label, value, hint, big }: { label: string; value: string; hint?: string; big?: boolean }) {
  return (
    <div className={cn("rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3", big && "px-5 py-4")}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-display font-bold tabular-nums", big ? "text-3xl" : "text-2xl")}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function SmallBtn({ icon: Icon, label, onClick }: { icon: typeof Plus; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex h-10 items-center gap-1.5 rounded-md border border-white/12 bg-white/[0.04] px-3 text-xs font-medium hover:border-white/30">
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function ShareBtn({ icon: Icon, label, onClick }: { icon: typeof Copy; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex h-11 items-center gap-2 rounded-md border border-white/12 bg-white/[0.04] px-4 text-sm font-medium transition-colors hover:border-white/30">
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}
