// Public Speed Potential Calculator — pure, client-side math.
// Reusable framework for future Strength Lab free tools (jump, relative strength, etc.).

export const YD_TO_MPH = 2.0454545; // mph = yards * 2.0454545 / seconds
export const MPH_TO_YPS = 0.4888889; // yards per second per mph

export type SplitFormat = "segment" | "cumulative";
export type TimingMethod = "official40" | "splits";

export type SplitInput = { distance: number; time: number | null };

export type Segment = {
  from: number;
  to: number;
  distance: number;
  splitTime: number;
  cumulativeTime: number;
  mph: number;
  pctOfPeak: number;
  fastest: boolean;
};

export type FortySource = "official" | "split" | "predicted";

export type SpeedResult = {
  heightIn: number;
  weightLb: number;
  ppi: number;
  segments: Segment[];
  peakMph: number;
  peakMphEstimated: boolean;
  bestSegment: Segment | null;
  totalDistance: number;
  totalTime: number;
  forty: number | null;
  fortySource: FortySource;
  score: number; // decimal, internal
  displayScore: number; // rounded 1..15
  row: number; // matrix row index (MPH band)
  col: number; // matrix col index (PPI band)
  tier: Tier;
};

export type TierKey = "diamond" | "platinum" | "gold" | "silver" | "bronze";
export type Tier = {
  key: TierKey;
  label: string;
  range: string;
  color: string; // oklch color for glow/text
  comparison: string;
};

export const TIERS: Tier[] = [
  {
    key: "diamond",
    label: "Diamond",
    range: "1–3",
    color: "oklch(0.86 0.11 210)",
    comparison:
      "Comparable to high-level collegiate skill positions — receivers and defensive backs — for size-adjusted speed.",
  },
  {
    key: "platinum",
    label: "Platinum",
    range: "4–6",
    color: "oklch(0.90 0.02 250)",
    comparison:
      "Comparable to college-recruitable skill and hybrid athletes. Strong speed for your body size.",
  },
  {
    key: "gold",
    label: "Gold",
    range: "7–9",
    color: "oklch(0.82 0.15 85)",
    comparison:
      "Comparable to many varsity high school skill players. Solid base with real upside remaining.",
  },
  {
    key: "silver",
    label: "Silver",
    range: "10–12",
    color: "oklch(0.78 0.01 250)",
    comparison:
      "Developing profile. Targeted acceleration work and consistent training should move this quickly.",
  },
  {
    key: "bronze",
    label: "Bronze",
    range: "13–15",
    color: "oklch(0.68 0.11 55)",
    comparison:
      "Focus on improving peak speed and body composition. Sprint mechanics and strength work pay off fastest here.",
  },
];

export function tierForScore(displayScore: number): Tier {
  if (displayScore <= 3) return TIERS[0];
  if (displayScore <= 6) return TIERS[1];
  if (displayScore <= 9) return TIERS[2];
  if (displayScore <= 12) return TIERS[3];
  return TIERS[4];
}

// ---------- Scoring matrices (Peak MPH × Pounds-Per-Inch) ----------
// Two separate source matrices, one per gender. In both, 1 is the best score and
// 15 the most developmental; each matrix is linear, so it reduces to a formula.
//
// MALE (colored matrix): rows 23.0 -> 14.0 mph in 0.5 steps, columns start at
// 1.250 PPI in 0.125 steps. Score 15 sits at (23.0 mph, 1.250 PPI).
//   score = 71 - 8*PPI - 2*MPH
//
// FEMALE (uncolored matrix): rows 20.0 -> 13.0 mph in 0.5 steps, columns start at
// 1.075 PPI in 0.05 steps. Score 15 sits at (19.5 mph, 1.075 PPI).
//   score = 75.5 - 20*PPI - 2*MPH
export type Gender = "male" | "female";

export const MATRIX = {
  male: { mphTop: 23, mphStep: 0.5, mphRows: 19, ppiStart: 1.25, ppiStep: 0.125, ppiCoef: 8, constant: 71 },
  female: { mphTop: 20, mphStep: 0.5, mphRows: 15, ppiStart: 1.075, ppiStep: 0.05, ppiCoef: 20, constant: 75.5 },
} as const;

export const MPH_BREAKS = [23, 21, 19, 17, 15, 13]; // descending edges -> 5 bands
export const PPI_BREAKS = [3.2, 2.8, 2.4, 2.0]; // descending edges -> 3 bands

export const MPH_BANDS = [
  "21.0+ mph",
  "19.0 – 21.0",
  "17.0 – 19.0",
  "15.0 – 17.0",
  "Under 15.0",
];
export const PPI_BANDS = ["2.80+ PPI", "2.40 – 2.80", "Under 2.40"];

export function cellScore(row: number, col: number) {
  return row * 3 + col + 1;
}

export function scoreFor(peakMph: number, ppi: number, gender: Gender = "male") {
  const m = MATRIX[gender];
  const raw = clamp(m.constant - m.ppiCoef * ppi - 2 * peakMph, 1, 15);
  // Matrix row/col indices (for the legend grid), clamped to the printed matrix.
  const row = clamp(Math.round((m.mphTop - peakMph) / m.mphStep), 0, m.mphRows - 1);
  const col = clamp(Math.round((ppi - m.ppiStart) / m.ppiStep), 0, 30);
  return { score: raw, displayScore: Math.min(15, Math.max(1, Math.round(raw))), row, col };
}



export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function mphFor(yards: number, seconds: number) {
  return seconds > 0 ? (yards * YD_TO_MPH) / seconds : 0;
}

// ---------- Main calculation ----------
export type CalcInput = {
  heightIn: number;
  weightLb: number;
  method: TimingMethod;
  officialForty: number | null;
  format: SplitFormat;
  gender?: Gender;
  splits: SplitInput[]; // ordered by distance ascending
};

export function calculateSpeedPotential(input: CalcInput): SpeedResult | null {
  const { heightIn, weightLb } = input;
  if (!(heightIn > 0) || !(weightLb > 0)) return null;
  const ppi = weightLb / heightIn;

  // Keep every selected distance in order so an unfilled row still defines the
  // segment boundary (a 30–40 split stays 10 yd even if 30 has no time yet).
  const rows = input.method === "splits"
    ? [...input.splits].sort((a, b) => a.distance - b.distance)
    : [];

  const segments: Segment[] = [];
  let cumulative = 0;
  let prevDistance = 0;

  for (const r of rows) {
    const segDistance = r.distance - prevDistance;
    if (segDistance <= 0) continue;
    if (r.time == null || !(r.time > 0)) {
      prevDistance = r.distance;
      continue;
    }
    const time = Number(r.time);
    let segTime: number;
    if (input.format === "segment") {
      segTime = time;
      cumulative += segTime;
    } else {
      segTime = time - cumulative;
      cumulative = time;
    }
    if (!(segTime > 0)) continue;
    segments.push({
      from: prevDistance,
      to: r.distance,
      distance: segDistance,
      splitTime: segTime,
      cumulativeTime: cumulative,
      mph: mphFor(segDistance, segTime),
      pctOfPeak: 0,
      fastest: false,
    });
    prevDistance = r.distance;
  }

  const official = input.method === "official40" ? input.officialForty : input.officialForty;

  let peakMph = 0;
  let peakMphEstimated = false;

  if (segments.length) {
    peakMph = Math.max(...segments.map((s) => s.mph));
  } else if (official && official > 0) {
    // Estimate peak from a 40 time: peak is ~16% above the 40-yard average.
    peakMph = mphFor(40, official) * 1.16;
    peakMphEstimated = true;
  }
  if (!(peakMph > 0)) return null;

  for (const s of segments) {
    s.pctOfPeak = (s.mph / peakMph) * 100;
    s.fastest = Math.abs(s.mph - peakMph) < 1e-9;
  }
  const bestSegment = segments.find((s) => s.fastest) ?? null;

  const totalDistance = segments.length ? segments[segments.length - 1].to : 0;
  const totalTime = segments.length ? segments[segments.length - 1].cumulativeTime : 0;

  // ---------- 40 resolution ----------
  let forty: number | null = null;
  let fortySource: FortySource = "predicted";
  if (official && official > 0) {
    forty = official;
    fortySource = "official";
  } else if (segments.length) {
    const at40 = segments.find((s) => Math.abs(s.to - 40) < 1e-9);
    if (at40) {
      forty = at40.cumulativeTime;
      fortySource = "split";
    } else if (totalDistance > 40) {
      // interpolate within the segment that crosses 40
      const seg = segments.find((s) => s.from < 40 && s.to > 40);
      if (seg) {
        const frac = (40 - seg.from) / seg.distance;
        forty = seg.cumulativeTime - seg.splitTime + seg.splitTime * frac;
        fortySource = "predicted";
      }
    } else {
      // extend at 97% of peak velocity
      const remaining = 40 - totalDistance;
      const yps = peakMph * MPH_TO_YPS * 0.97;
      forty = yps > 0 ? totalTime + remaining / yps : null;
      fortySource = "predicted";
    }
  }

  const { score, displayScore, row, col } = scoreFor(peakMph, ppi, input.gender ?? "male");

  return {
    heightIn,
    weightLb,
    ppi,
    segments,
    peakMph,
    peakMphEstimated,
    bestSegment,
    totalDistance,
    totalTime,
    forty,
    fortySource,
    score,
    displayScore,
    row,
    col,
    tier: tierForScore(displayScore),
  };
}

export function fortyLabel(source: FortySource) {
  if (source === "official") return "Official 40";
  if (source === "split") return "Split-derived 40";
  return "Predicted 40";
}

/** Plain-language meaning for each speed tier (shown in the info popover and exports). */
export const TIER_MEANING: Record<TierKey, string> = {
  diamond: "Elite",
  platinum: "Advanced",
  gold: "Proficient",
  silver: "Developing",
  bronze: "Foundational",
};
