// Sprint Speed Profile — pure, client-side sprint math for the public free tool.
// Presentation-free: every value here is derived from user input only.

import { scoreFor, tierForScore, type Gender, type Tier } from "./speed-potential";
import { predict40FromSplits, type SprintCheckpoint } from "./predict-40";


export type { Gender };

export const YARDS_TO_METERS = 0.9144;
export const MS_TO_MPH = 2.2369362920544;
export const MS_TO_KPH = 3.6;
export const VELOCITY_CHANGE_TOLERANCE_MS = 0.1;

export type DistanceUnit = "yards" | "meters";
export type EntryMode = "segment" | "cumulative";

export type TimingMethodOption =
  | "gates"
  | "freelap"
  | "laser"
  | "radar"
  | "hand"
  | "shredmill"
  | "other";

export const TIMING_METHODS: Array<{ value: TimingMethodOption; label: string }> = [
  { value: "gates", label: "Electronic timing gates" },
  { value: "freelap", label: "Freelap" },
  { value: "laser", label: "Laser timing" },
  { value: "radar", label: "Radar timing" },
  { value: "hand", label: "Hand timed" },
  { value: "shredmill", label: "Shredmill" },
  { value: "other", label: "Other" },
];

export const START_POSITIONS = [
  "Two-point",
  "Three-point",
  "Four-point",
  "Standing",
  "Flying",
  "Other",
] as const;

export const SURFACES = ["Track", "Turf", "Grass", "Court", "Shredmill", "Other"] as const;

// ---------- Templates ----------
export type SprintTemplate = {
  id: string;
  label: string;
  unit: DistanceUnit;
  /** Segment distances in order, in the template unit. */
  segments: number[];
  /** Untimed build-in distance for flying tests (context only). */
  flying?: boolean;
};

export const TEMPLATES: SprintTemplate[] = [
  { id: "10y", label: "10-Yard Sprint", unit: "yards", segments: [5, 5] },
  { id: "20y", label: "20-Yard Sprint", unit: "yards", segments: [5, 5, 10] },
  { id: "30y", label: "30-Yard Sprint", unit: "yards", segments: [10, 10, 10] },
  { id: "40y", label: "40-Yard Dash", unit: "yards", segments: [10, 10, 10, 10] },
  { id: "50y", label: "50-Yard Sprint", unit: "yards", segments: [10, 10, 10, 10, 10] },
  { id: "60y", label: "60-Yard Sprint", unit: "yards", segments: [10, 10, 10, 10, 10, 10] },
  { id: "fly10y", label: "Flying 10 (yards)", unit: "yards", segments: [10], flying: true },
  { id: "fly20y", label: "Flying 20 (yards)", unit: "yards", segments: [20], flying: true },
  { id: "10m", label: "10-Meter Sprint", unit: "meters", segments: [10] },
  { id: "20m", label: "20-Meter Sprint", unit: "meters", segments: [10, 10] },
  { id: "30m", label: "30-Meter Sprint", unit: "meters", segments: [10, 10, 10] },
  { id: "fly10m", label: "Flying 10 Meters", unit: "meters", segments: [10], flying: true },
  { id: "fly20m", label: "Flying 20 Meters", unit: "meters", segments: [20], flying: true },
  { id: "custom", label: "Custom Test", unit: "yards", segments: [10, 10, 10, 10] },
];

export const MAX_TOTAL_YARDS = 60;
export const MAX_TOTAL_METERS = 60;

export function convertDistanceToMeters(distance: number, unit: DistanceUnit) {
  return unit === "yards" ? distance * YARDS_TO_METERS : distance;
}
export function metersToYards(m: number) {
  return m / YARDS_TO_METERS;
}

// ---------- Inputs ----------
export type SplitRowInput = {
  id: string;
  label: string;
  /** Segment distance (segment mode) or checkpoint distance (cumulative mode). */
  distance: number;
  /** Segment time (segment mode) or cumulative time (cumulative mode). */
  time: number | null;
};

export type ProfileInput = {
  athleteName?: string;
  heightIn: number;
  weightLb: number;
  gender: Gender;
  unit: DistanceUnit;
  entryMode: EntryMode;
  rows: SplitRowInput[];
  officialForty: number | null;
  flying?: boolean;
  timingMethod: TimingMethodOption;
  startPosition: string;
  surface: string;
};

// ---------- Outputs ----------
export type SprintSplit = {
  id: string;
  label: string;
  /** Track position where this segment starts / ends, in yards from the start line. */
  fromYards: number;
  toYards: number;
  segmentDistanceMeters: number;
  segmentDistanceYards: number;
  segmentTimeSeconds: number;
  cumulativeDistanceMeters: number;
  cumulativeDistanceYards: number;
  /** Elapsed time from the start line — null when an earlier segment was untimed. */
  cumulativeTimeSeconds: number | null;
  velocityMs: number;
  speedMph: number;
  speedKph: number;
  percentOfPeakSpeed: number;
  changeInVelocityMs: number | null;
  estimatedAccelerationMs2: number | null;
  isPeak: boolean;
  isPost40: boolean;
  flagged: boolean;
};


export type FortySource = "entered" | "split" | "interpolated" | "modeled" | "none";
export type Confidence = "higher" | "moderate" | "limited";

export type ReviewNote = {
  kind: "review" | "timing" | "data" | "observation";
  message: string;
};

export type SprintProfile = {
  splits: SprintSplit[];
  heightIn: number;
  weightLb: number;
  gender: Gender;
  ppi: number;
  totalDistanceMeters: number;
  totalDistanceYards: number;
  totalTimeSeconds: number;
  /** Distance that was actually timed (excludes untimed gaps). */
  timedDistanceYards: number;
  timedTimeSeconds: number;
  /** True when every segment from the start line was timed. */
  contiguousFromStart: boolean;
  averageVelocityMs: number;
  averageMph: number;
  peakVelocityMs: number;
  peakMph: number;
  peakSplit: SprintSplit | null;
  peakEstimated: boolean;
  finalSplitMph: number | null;
  fortySeconds: number | null;
  fortySource: FortySource;
  fortyConfidence: Confidence;
  post40Maintenance: number | null;
  bestPost40Mph: number | null;
  score: number;
  displayScore: number;
  scoreMeasured: boolean;
  matrixMph: number;
  matrixPpi: number;
  tier: Tier;
  notes: ReviewNote[];
};

export function fortySourceLabel(s: FortySource) {
  switch (s) {
    case "entered":
      return "Entered 40-Yard Time";
    case "split":
      return "Split-Derived 40";
    case "interpolated":
      return "Predicted 40";
    case "modeled":
      return "Predicted 40";
    default:
      return "40-Yard Result";
  }
}

export function confidenceLabel(c: Confidence) {
  return c === "higher" ? "Higher confidence" : c === "moderate" ? "Moderate confidence" : "Limited confidence";
}

function finite(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/*
 * 40-yard dash speed goal/benchmark standards adapted from:
 * SimpliFaster - "Speed Goals for Football: The 40-Yard Dash"
 * https://simplifaster.com/articles/speed-goals-football-40-yard-dash/
 */

/**
 * Empirical 40-yard split reference standards.
 * Each row: [40 time, 0-10, 10-20, 20-30, 30-40] in seconds.
 * Derived from actual 40-yard dash performances — used to project a 40 from
 * partial split data instead of assuming a flat percentage of peak velocity.
 */
const FORTY_REFERENCE: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [4.10, 1.42, 0.98, 0.88, 0.82],
  [4.15, 1.44, 0.99, 0.89, 0.83],
  [4.20, 1.46, 1.00, 0.90, 0.84],
  [4.25, 1.48, 1.01, 0.91, 0.85],
  [4.30, 1.50, 1.02, 0.92, 0.86],
  [4.35, 1.52, 1.03, 0.93, 0.87],
  [4.40, 1.54, 1.04, 0.94, 0.88],
  [4.45, 1.56, 1.05, 0.95, 0.89],
  [4.50, 1.58, 1.06, 0.96, 0.90],
  [4.55, 1.60, 1.07, 0.97, 0.91],
  [4.60, 1.62, 1.08, 0.98, 0.92],
  [4.65, 1.64, 1.09, 0.99, 0.93],
  [4.70, 1.65, 1.10, 1.00, 0.95],
  [4.75, 1.67, 1.11, 1.01, 0.96],
  [4.80, 1.68, 1.12, 1.02, 0.98],
  [4.85, 1.70, 1.13, 1.03, 0.99],
  [4.90, 1.71, 1.14, 1.04, 1.01],
  [4.95, 1.73, 1.15, 1.05, 1.02],
  [5.00, 1.74, 1.16, 1.06, 1.04],
  [5.05, 1.76, 1.17, 1.07, 1.05],
  [5.10, 1.77, 1.18, 1.08, 1.07],
  [5.15, 1.79, 1.19, 1.09, 1.08],
  [5.20, 1.80, 1.20, 1.10, 1.10],
  [5.25, 1.82, 1.21, 1.11, 1.11],
  [5.30, 1.84, 1.22, 1.12, 1.13],
  [5.35, 1.85, 1.23, 1.13, 1.14],
  [5.40, 1.86, 1.24, 1.14, 1.16],
  [5.45, 1.88, 1.25, 1.15, 1.17],
];

/** Cumulative time a reference athlete reaches `yards` (0 < yards <= 40). */
function referenceTimeAt(row: readonly [number, number, number, number, number], yards: number) {
  const segs = [row[1], row[2], row[3], row[4]];
  let t = 0;
  let remaining = Math.min(yards, 40);
  for (const seg of segs) {
    if (remaining <= 0) break;
    const covered = Math.min(10, remaining);
    t += seg * (covered / 10);
    remaining -= covered;
  }
  return t;
}

/**
 * Project a 40-yard time from a measured split taken from a standing start.
 * Finds where the athlete's cumulative time at `yards` falls in the empirical
 * reference table and interpolates (or extrapolates) the matching 40 time.
 */
export function projectFortyFromSplit(yards: number, seconds: number): number | null {
  if (!(yards > 0) || !(seconds > 0) || yards > 40) return null;
  const pts = FORTY_REFERENCE.map((r) => ({ t: referenceTimeAt(r, yards), forty: r[0] }));
  if (seconds <= pts[0].t) {
    const a = pts[0], b = pts[1];
    const slope = (b.forty - a.forty) / (b.t - a.t);
    return a.forty + (seconds - a.t) * slope;
  }
  const last = pts.length - 1;
  if (seconds >= pts[last].t) {
    const a = pts[last - 1], b = pts[last];
    const slope = (b.forty - a.forty) / (b.t - a.t);
    return b.forty + (seconds - b.t) * slope;
  }
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[i + 1];
    if (seconds >= a.t && seconds <= b.t) {
      const f = (seconds - a.t) / (b.t - a.t);
      return a.forty + (b.forty - a.forty) * f;
    }
  }
  return null;
}

/**
 * Project a 40-yard time from a single timed segment anywhere in the run
 * (for example a 30–40 yd split of 0.94s), by matching that segment time against
 * the same span in the empirical reference table.
 */
export function projectFortyFromSegment(
  fromYards: number,
  toYards: number,
  seconds: number,
): number | null {
  if (!(seconds > 0) || !(toYards > fromYards) || fromYards < 0 || toYards > 40) return null;
  if (fromYards <= 0) return projectFortyFromSplit(toYards, seconds);
  const pts = FORTY_REFERENCE.map((r) => ({
    t: referenceTimeAt(r, toYards) - referenceTimeAt(r, fromYards),
    forty: r[0],
  }));
  if (seconds <= pts[0].t) {
    const a = pts[0], b = pts[1];
    const slope = (b.forty - a.forty) / (b.t - a.t);
    return a.forty + (seconds - a.t) * slope;
  }
  const last = pts.length - 1;
  if (seconds >= pts[last].t) {
    const a = pts[last - 1], b = pts[last];
    const slope = (b.forty - a.forty) / (b.t - a.t);
    return b.forty + (seconds - b.t) * slope;
  }
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[i + 1];
    if (seconds >= a.t && seconds <= b.t) {
      const f = (seconds - a.t) / (b.t - a.t);
      return a.forty + (b.forty - a.forty) * f;
    }
  }
  return null;
}


export function computeSprintProfile(input: ProfileInput): SprintProfile | null {
  const { heightIn, weightLb, unit } = input;
  const gender: Gender = input.gender ?? "male";
  if (!(heightIn > 0) || !(weightLb > 0)) return null;
  const ppi = weightLb / heightIn;

  const notes: ReviewNote[] = [];
  const splits: SprintSplit[] = [];

  let timedMeters = 0;
  let elapsedTime = 0;
  let prevVelocity: number | null = null;
  // Last cumulative checkpoint that actually had a time entered (cumulative mode only).
  let lastTimedCheckpointTime: number | null = null;
  // True while every segment from the start line has been timed. Once a segment is
  // left blank the run is a set of snapshots, not a continuous clock.
  let contiguousFromStart = true;

  // Declared geometry: every row keeps its own segment span (0–10, 10–20, 30–40 …)
  // even when earlier rows are left blank. Blank rows never move a later segment
  // closer to the start line — the athlete still ran the whole distance.
  let declaredFrom = 0;

  for (const row of input.rows) {
    if (!finite(row.distance) || row.distance <= 0) {
      if (row.time != null) notes.push({ kind: "data", message: `${row.label}: distance must be greater than zero.` });
      continue;
    }

    const declaredTo = input.entryMode === "segment" ? declaredFrom + row.distance : row.distance;
    const segDistance = declaredTo - declaredFrom;
    const fromYards = unit === "yards" ? declaredFrom : metersToYards(declaredFrom);
    const toYards = unit === "yards" ? declaredTo : metersToYards(declaredTo);

    // Treat blank, zero, or negative entries as "not timed" rather than as data errors.
    const entered = finite(row.time) && row.time > 0 ? row.time : null;

    let segTime: number | null = null;
    if (entered != null) {
      if (input.entryMode === "segment") {
        segTime = entered;
      } else if (lastTimedCheckpointTime != null && entered > lastTimedCheckpointTime) {
        segTime = entered - lastTimedCheckpointTime;
      } else {
        // No usable earlier checkpoint (blank rows above): the value is this segment's split.
        segTime = entered;
      }
      lastTimedCheckpointTime = input.entryMode === "cumulative" ? entered : null;
    }

    declaredFrom = declaredTo;

    if (segTime == null || !(segTime > 0) || !(segDistance > 0)) {
      if (segTime != null) notes.push({ kind: "review", message: `${row.label}: enter a positive distance and time.` });
      contiguousFromStart = false;
      continue;
    }

    const segMeters = convertDistanceToMeters(segDistance, unit);
    timedMeters += segMeters;
    elapsedTime += segTime;

    const velocityMs = segMeters / segTime;
    const acceleration = prevVelocity == null ? velocityMs / segTime : (velocityMs - prevVelocity) / segTime;

    splits.push({
      id: row.id,
      label: row.label,
      fromYards,
      toYards,
      segmentDistanceMeters: segMeters,
      segmentDistanceYards: metersToYards(segMeters),
      segmentTimeSeconds: segTime,
      cumulativeDistanceMeters: convertDistanceToMeters(declaredTo, unit),
      cumulativeDistanceYards: toYards,
      cumulativeTimeSeconds: contiguousFromStart ? elapsedTime : null,
      velocityMs,
      speedMph: velocityMs * MS_TO_MPH,
      speedKph: velocityMs * MS_TO_KPH,
      percentOfPeakSpeed: 0,
      changeInVelocityMs: prevVelocity == null ? null : velocityMs - prevVelocity,
      estimatedAccelerationMs2: acceleration,
      isPeak: false,
      isPost40: false,
      flagged: velocityMs * MS_TO_MPH > 30,
    });
    prevVelocity = velocityMs;
  }



  const officialForty = finite(input.officialForty) && input.officialForty > 0 ? input.officialForty : null;

  let peakVelocityMs = 0;
  let peakEstimated = false;
  if (splits.length) {
    peakVelocityMs = Math.max(...splits.map((s) => s.velocityMs));
  } else if (officialForty) {
    // Peak is estimated at ~16% above the average velocity over 40 yards.
    peakVelocityMs = (convertDistanceToMeters(40, "yards") / officialForty) * 1.16;
    peakEstimated = true;
  }
  if (!(peakVelocityMs > 0)) return null;

  for (const s of splits) {
    s.percentOfPeakSpeed = (s.velocityMs / peakVelocityMs) * 100;
    s.isPeak = Math.abs(s.velocityMs - peakVelocityMs) < 1e-9;
    s.isPost40 = s.cumulativeDistanceYards - s.segmentDistanceYards >= 39.999;
  }
  const peakSplit = splits.find((s) => s.isPeak) ?? null;

  // Furthest point on the track that was reached, not the sum of timed segments.
  const totalDistanceMeters = splits.length ? splits[splits.length - 1].cumulativeDistanceMeters : 0;
  const totalDistanceYards = metersToYards(totalDistanceMeters);
  // Elapsed time from the start line is only known when every segment was timed.
  const lastCumulativeTime = splits.length ? splits[splits.length - 1].cumulativeTimeSeconds : null;
  const totalTimeSeconds = lastCumulativeTime ?? 0;
  const timedDistanceYards = metersToYards(timedMeters);
  const timedTimeSeconds = elapsedTime;
  const averageVelocityMs = timedTimeSeconds > 0 ? timedMeters / timedTimeSeconds : 0;

  // ---------- 40-yard resolution ----------
  let fortySeconds: number | null = null;
  let fortySource: FortySource = "none";
  let fortyConfidence: Confidence = "limited";

  if (officialForty) {
    fortySeconds = officialForty;
    fortySource = "entered";
    fortyConfidence = "higher";
  } else if (splits.length && !input.flying) {
    // Only splits with a known elapsed time from the start line can be modeled directly.
    const checkpoints: SprintCheckpoint[] = splits
      .filter((s): s is SprintSplit & { cumulativeTimeSeconds: number } => s.cumulativeTimeSeconds != null)
      .map((s) => ({ distanceYards: s.cumulativeDistanceYards, cumulativeTimeSeconds: s.cumulativeTimeSeconds }));
    const predicted = checkpoints.length ? predict40FromSplits(checkpoints) : null;

    if (predicted?.predicted40Seconds != null) {
      fortySeconds = predicted.predicted40Seconds;
      fortySource =
        predicted.method === "actual-checkpoint"
          ? "split"
          : predicted.method === "interpolated"
            ? "interpolated"
            : "modeled";
      fortyConfidence = predicted.confidence === "unavailable" ? "limited" : predicted.confidence;
      if (predicted.warning) notes.push({ kind: "data", message: predicted.warning });
    } else if (checkpoints.length === 1 || checkpoints.length === 2) {
      // One or two checkpoints from the start line: empirical 40-yard split standards.
      const last = checkpoints[checkpoints.length - 1];
      const projected = projectFortyFromSplit(last.distanceYards, last.cumulativeTimeSeconds);
      if (projected && projected > last.cumulativeTimeSeconds) {
        fortySeconds = projected;
        fortySource = "modeled";
        fortyConfidence = last.distanceYards >= 20 ? "moderate" : "limited";
      }
    }

    if (fortySeconds == null) {
      // Snapshot segments (e.g. only a 10–20 and a 30–40 split): project a 40 from
      // each segment against the reference table and average the projections.
      const projections = splits
        .map((s) => projectFortyFromSegment(s.fromYards, s.toYards, s.segmentTimeSeconds))
        .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
      if (projections.length) {
        fortySeconds = Number((projections.reduce((a, b) => a + b, 0) / projections.length).toFixed(2));
        fortySource = "modeled";
        fortyConfidence = projections.length >= 2 ? "moderate" : "limited";
        notes.push({
          kind: "data",
          message:
            "Some segments of the run were not timed, so the 40 is projected from the timed segments rather than a continuous clock.",
        });
      }
    }
  }



  // ---------- Post-40 analysis ----------
  const post40 = splits.filter((s) => s.isPost40);
  let post40Maintenance: number | null = null;
  let bestPost40Mph: number | null = null;
  if (post40.length) {
    const dist = post40.reduce((a, s) => a + s.segmentDistanceMeters, 0);
    const time = post40.reduce((a, s) => a + s.segmentTimeSeconds, 0);
    if (dist > 0 && time > 0) post40Maintenance = (dist / time / peakVelocityMs) * 100;
    bestPost40Mph = Math.max(...post40.map((s) => s.speedMph));
  }

  const peakMph = peakVelocityMs * MS_TO_MPH;
  const { score, displayScore } = scoreFor(peakMph, ppi, gender);

  // ---------- Review notes ----------
  if (splits.length >= 2) {
    const last = splits[splits.length - 1];
    if (last.isPeak) {
      notes.push({ kind: "observation", message: "Speed continued to increase through the final split." });
      notes.push({ kind: "review", message: "The sprint may not have been long enough to capture peak speed." });
    } else {
      notes.push({ kind: "observation", message: "Peak MPH occurred before the final split." });
      const drop = 100 - last.percentOfPeakSpeed;
      if (drop <= 3) notes.push({ kind: "observation", message: "Speed remained near peak through the final segment." });
      else notes.push({ kind: "observation", message: "The athlete lost measurable speed after reaching peak MPH." });
    }
    for (let i = 1; i < splits.length - 1; i++) {
      const prev = splits[i - 1].speedMph;
      const next = splits[i + 1].speedMph;
      const cur = splits[i].speedMph;
      const neighborAvg = (prev + next) / 2;
      if (neighborAvg > 0 && Math.abs(cur - neighborAvg) / neighborAvg > 0.15)
        notes.push({ kind: "review", message: `${splits[i].label} differs substantially from the surrounding segments. Review the entered split before using this result.` });
    }
    if (splits[0].estimatedAccelerationMs2 != null && splits[0].estimatedAccelerationMs2 > 12)
      notes.push({ kind: "review", message: "The first split appears unusually fast relative to later splits." });
  }
  if (splits.some((s) => s.flagged))
    notes.push({ kind: "review", message: "One split produced an implausible speed. Possible timing issue." });
  if (fortySource === "modeled")
    notes.push({ kind: "data", message: "The predicted 40 is based on limited split information." });
  if (input.timingMethod === "hand")
    notes.push({ kind: "timing", message: "Hand-timed results may differ from electronically timed results." });

  return {
    splits,
    heightIn,
    weightLb,
    gender,
    ppi,
    totalDistanceMeters,
    totalDistanceYards,
    totalTimeSeconds,
    timedDistanceYards,
    timedTimeSeconds,
    contiguousFromStart: lastCumulativeTime != null,
    averageVelocityMs,
    averageMph: averageVelocityMs * MS_TO_MPH,
    peakVelocityMs,
    peakMph,
    peakSplit,
    peakEstimated,
    finalSplitMph: splits.length ? splits[splits.length - 1].speedMph : null,
    fortySeconds,
    fortySource,
    fortyConfidence,
    post40Maintenance,
    bestPost40Mph,
    score,
    displayScore,
    scoreMeasured: splits.length > 0,
    matrixMph: Math.round(peakMph * 2) / 2,
    matrixPpi: Math.round(ppi * 20) / 20,
    tier: tierForScore(displayScore),
    notes,
  };
}

export function fmt(n: number | null | undefined, digits = 2, suffix = "") {
  if (n == null || !Number.isFinite(n)) return "N/A";
  return `${n.toFixed(digits)}${suffix}`;
}

export function profileToCsv(input: ProfileInput, p: SprintProfile) {
  const rows: string[][] = [
    ["Athlete", input.athleteName || ""],
    ["Height (in)", String(p.heightIn)],
    ["Bodyweight (lb)", String(p.weightLb)],
    ["Gender", p.gender === "female" ? "Female" : "Male"],
    ["Pounds per inch", p.ppi.toFixed(2)],
    ["Timing method", TIMING_METHODS.find((t) => t.value === input.timingMethod)?.label ?? ""],
    ["Start position", input.startPosition],
    ["Surface", input.surface],
    ["Distance unit", input.unit],
    ["Peak MPH", p.peakMph.toFixed(2)],
    ["Peak velocity (m/s)", p.peakVelocityMs.toFixed(2)],
    ["Average MPH", p.averageMph.toFixed(2)],
    ["Total distance (yd)", p.totalDistanceYards.toFixed(1)],
    ["Timed distance (yd)", p.timedDistanceYards.toFixed(1)],
    ["Total time (s)", p.contiguousFromStart ? p.totalTimeSeconds.toFixed(2) : "N/A (untimed segments)"],
    [fortySourceLabel(p.fortySource), p.fortySeconds ? p.fortySeconds.toFixed(2) : "N/A"],
    ["Speed score", `${p.displayScore} of 15`],
    ["Tier", p.tier.label],
    [],
    ["Split", "Segment distance (yd)", "Segment time (s)", "Cumulative distance (yd)", "Cumulative time (s)", "m/s", "MPH", "KPH", "% of peak", "Δ velocity (m/s)", "Est. acceleration (m/s²)"],
  ];
  for (const s of p.splits) {
    rows.push([
      s.label,
      s.segmentDistanceYards.toFixed(2),
      s.segmentTimeSeconds.toFixed(2),
      s.cumulativeDistanceYards.toFixed(2),
      s.cumulativeTimeSeconds == null ? "" : s.cumulativeTimeSeconds.toFixed(2),
      s.velocityMs.toFixed(2),
      s.speedMph.toFixed(2),
      s.speedKph.toFixed(2),
      s.percentOfPeakSpeed.toFixed(1),
      s.changeInVelocityMs == null ? "" : s.changeInVelocityMs.toFixed(2),
      s.estimatedAccelerationMs2 == null ? "" : s.estimatedAccelerationMs2.toFixed(2),
    ]);
  }
  return rows.map((r) => r.map((c) => `"${(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
