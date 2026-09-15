// Canonical one-rep-max estimation for Strength Lab.
// The SQL mirror of this file is public.estimate_1rm(load, reps, formula) — keep
// the two in sync. Any change here must be applied there in the same migration.
//
// Sources:
//  - Epley (1985): 1RM = w * (1 + r/30)
//  - Brzycki (1993): 1RM = w * 36 / (37 - r)   (valid for r < 37)
//  - Lombardi (1989): 1RM = w * r^0.10
//  - O'Conner et al. (1989): 1RM = w * (1 + 0.025r)

export const ONE_RM_FORMULAS = ["epley", "brzycki", "lombardi", "oconner"] as const;
export type OneRmFormula = (typeof ONE_RM_FORMULAS)[number];

export const DEFAULT_1RM_FORMULA: OneRmFormula = "epley";

export const ONE_RM_META: Record<OneRmFormula, { label: string; expression: string; citation: string }> = {
  epley: { label: "Epley", expression: "w × (1 + r/30)", citation: "Epley, B. (1985). Poundage Chart. Boyd Epley Workout." },
  brzycki: { label: "Brzycki", expression: "w × 36 ÷ (37 − r)", citation: "Brzycki, M. (1993). JOPERD, 64(1), 88–90." },
  lombardi: { label: "Lombardi", expression: "w × r^0.10", citation: "Lombardi, V. P. (1989). Beginning Weight Training." },
  oconner: { label: "O'Conner", expression: "w × (1 + 0.025r)", citation: "O'Conner, B. et al. (1989). Weight Training Today." },
};

export function isOneRmFormula(v: unknown): v is OneRmFormula {
  return typeof v === "string" && (ONE_RM_FORMULAS as readonly string[]).includes(v);
}

/** Estimated 1RM in the same unit as `load`. Returns null on invalid input. */
export function estimate1RM(
  load: number | null | undefined,
  reps: number | null | undefined,
  formula: OneRmFormula = DEFAULT_1RM_FORMULA,
): number | null {
  const w = Number(load);
  const r = Number(reps);
  if (!Number.isFinite(w) || !Number.isFinite(r) || r < 1) return null;
  if (r === 1) return w;
  switch (formula) {
    case "brzycki":
      return r < 37 ? (w * 36) / (37 - r) : w * (1 + r / 30);
    case "lombardi":
      return w * Math.pow(r, 0.1);
    case "oconner":
      return w * (1 + 0.025 * r);
    case "epley":
    default:
      return w * (1 + r / 30);
  }
}

/** Estimated 1RM rounded to the nearest 5 lb (plate-friendly display). */
export function estimate1RMRounded(
  load: number | null | undefined,
  reps: number | null | undefined,
  formula: OneRmFormula = DEFAULT_1RM_FORMULA,
): number | null {
  const v = estimate1RM(load, reps, formula);
  return v == null ? null : Math.round(v / 5) * 5;
}

/** Predicted load for a target rep max, inverted from the same formula. */
export function predictRepMax(
  e1rm: number,
  reps: number,
  formula: OneRmFormula = DEFAULT_1RM_FORMULA,
): number {
  if (reps <= 1) return e1rm;
  switch (formula) {
    case "brzycki":
      return reps < 37 ? (e1rm * (37 - reps)) / 36 : e1rm / (1 + reps / 30);
    case "lombardi":
      return e1rm / Math.pow(reps, 0.1);
    case "oconner":
      return e1rm / (1 + 0.025 * reps);
    case "epley":
    default:
      return e1rm / (1 + reps / 30);
  }
}
