import { estimate1RMRounded } from "./one-rm";
import { getOrg1RMFormula } from "@/hooks/use-1rm-formula";

// Unit preferences and conversion.
// Canonical storage units in DB: weight = lb, distance/height = in, speed = seconds.
// Convert on display / on input using the user's preferred units.

export type WeightUnit = "lb" | "kg";
export type DistanceUnit = "in" | "ft" | "cm" | "m" | "yd";
export type SpeedUnit = "s" | "mph" | "m/s";

export type UnitPrefs = {
  weight: WeightUnit;
  distance: DistanceUnit;
  speed: SpeedUnit;
};

export const defaultPrefs: UnitPrefs = { weight: "lb", distance: "in", speed: "s" };

// Round a weight (lb) to the nearest 5 lb — matches typical plate math on a bar.
export function roundToFive(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) / 5) * 5;
}

// e1RM rounded to the nearest 5 lb, using the active org's configured formula.
export function epley1RM(load: number | null | undefined, reps: number | null | undefined): number | null {
  return estimate1RMRounded(load, reps, getOrg1RMFormula());
}

// ---------- Weight (canonical: lb) ----------
export function fromLb(lb: number, to: WeightUnit): number {
  return to === "kg" ? lb * 0.45359237 : lb;
}
export function toLb(v: number, from: WeightUnit): number {
  return from === "kg" ? v / 0.45359237 : v;
}

// ---------- Distance (canonical: in) ----------
const IN_PER: Record<DistanceUnit, number> = {
  in: 1, ft: 12, cm: 1 / 2.54, m: 100 / 2.54, yd: 36,
};
export function fromIn(inches: number, to: DistanceUnit): number {
  return inches / IN_PER[to];
}
export function toIn(v: number, from: DistanceUnit): number {
  return v * IN_PER[from];
}

// ---------- Speed / Sprint (canonical: seconds for a given distance in inches) ----------
// For sprints stored as seconds we can also present as mph or m/s given a distance.
export function secondsToMph(seconds: number, distanceIn: number): number {
  const miles = distanceIn / 63360;
  const hours = seconds / 3600;
  return hours > 0 ? miles / hours : 0;
}
export function secondsToMps(seconds: number, distanceIn: number): number {
  const meters = distanceIn * 0.0254;
  return seconds > 0 ? meters / seconds : 0;
}

export function formatWeight(lb: number | null | undefined, unit: WeightUnit, digits = 1): string {
  if (lb == null) return "—";
  const v = fromLb(lb, unit);
  return `${v.toFixed(digits)} ${unit}`;
}
export function formatDistance(inches: number | null | undefined, unit: DistanceUnit, digits = 1): string {
  if (inches == null) return "—";
  const v = fromIn(inches, unit);
  return `${v.toFixed(digits)} ${unit}`;
}
