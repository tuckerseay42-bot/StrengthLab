// Shared taxonomy tagging both sides of an injury-restriction conflict:
// which movements an exercise involves, and which movements an injury rules
// out. The same list backs the Exercise Library's tagging UI and the
// "restricted during" picker on an injury.
export const MOVEMENT_PATTERNS: { value: string; label: string }[] = [
  { value: "overhead", label: "Overhead" },
  { value: "lower_body", label: "Lower body" },
  { value: "upper_body_pressing", label: "Upper body — pressing" },
  { value: "upper_body_pulling", label: "Upper body — pulling" },
  { value: "running_sprinting", label: "Running / sprinting" },
  { value: "jumping_landing", label: "Jumping / landing" },
  { value: "spinal_loading", label: "Spinal loading" },
  { value: "twisting_rotation", label: "Twisting / rotation" },
  { value: "grip_intensive", label: "Grip intensive" },
];

export const MOVEMENT_PATTERN_LABEL: Record<string, string> = Object.fromEntries(
  MOVEMENT_PATTERNS.map((p) => [p.value, p.label]),
);
