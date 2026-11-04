import { describe, expect, it } from "vitest";
import { bestE1rm, referenceNameFor, suggestLoad } from "@/lib/prescription";
import type { RepMax } from "@/lib/queries";

const rm = (over: Partial<RepMax>): RepMax =>
  ({
    id: "r",
    athlete_id: "kid",
    exercise_id: null,
    exercise_name: "Bench Press",
    reps: 1,
    load: 200,
    tested_at: "2026-10-01",
    ...over,
  }) as RepMax;

const bench = {
  exercise_id: "ex-bench",
  exercise_name: "Bench Press",
  load: null,
  percent: 75,
  percent_of_exercise_id: null,
};

describe("a weight shows up whenever the athlete has a max for the lift", () => {
  it("prices a % set from a stored 1RM, rounded down to 5 lb", () => {
    const s = suggestLoad({ athleteId: "kid", exercise: bench, repMaxes: [rm({ load: 203 })] });
    expect(s?.load).toBe(150); // 75% of 203 = 152.25, down to the nearest 5
  });

  it("still finds the max when the stored row has no exercise id (rolled-up from lifts)", () => {
    const s = suggestLoad({
      athleteId: "kid",
      exercise: bench,
      repMaxes: [rm({ exercise_id: null, exercise_name: "  bench press " })],
    });
    expect(s?.load).toBe(150);
  });

  it("finds the max by id even when the stored name is spelled differently", () => {
    const s = suggestLoad({
      athleteId: "kid",
      exercise: bench,
      repMaxes: [rm({ exercise_id: "ex-bench", exercise_name: "Barbell Bench" })],
    });
    expect(s?.load).toBe(150);
  });

  it("uses only that athlete's maxes", () => {
    const s = suggestLoad({
      athleteId: "kid",
      exercise: bench,
      repMaxes: [rm({ athlete_id: "someone-else", load: 400 })],
    });
    expect(s).toBeNull();
  });

  it("estimates from a multi-rep max when there is no stored 1RM", () => {
    const best = bestE1rm([rm({ reps: 5, load: 170 })], "kid", "ex-bench", "Bench Press");
    expect(best?.e1rm).toBeGreaterThan(170);
  });
});

describe("a percentage of a different lift", () => {
  const boxSquat = {
    exercise_id: "ex-box",
    exercise_name: "Box Squat",
    load: null,
    percent: 70,
    percent_of_exercise_id: "ex-squat",
  };
  const squatMax = rm({ exercise_id: null, exercise_name: "Back Squat", load: 300 });

  it("cannot be priced unless the other lift's name is supplied", () => {
    expect(suggestLoad({ athleteId: "kid", exercise: boxSquat, repMaxes: [squatMax] })).toBeNull();
  });

  it("is priced from that lift's max once the name is supplied", () => {
    const names = new Map([["ex-squat", "Back Squat"]]);
    const s = suggestLoad({
      athleteId: "kid",
      exercise: boxSquat,
      repMaxes: [squatMax],
      referenceExerciseName: referenceNameFor(boxSquat, null, names),
    });
    expect(s?.load).toBe(210);
  });

  it("looks the name up from the set's own reference before the exercise's", () => {
    const names = new Map([
      ["ex-squat", "Back Squat"],
      ["ex-front", "Front Squat"],
    ]);
    expect(referenceNameFor(boxSquat, { percent_of_exercise_id: "ex-front" }, names)).toBe(
      "Front Squat",
    );
    expect(referenceNameFor(bench, null, names)).toBeNull();
    expect(referenceNameFor(boxSquat, null, undefined)).toBeNull();
  });
});

describe("explicit weights always show", () => {
  it("returns the programmed weight with no max at all", () => {
    const s = suggestLoad({
      athleteId: "kid",
      exercise: { ...bench, load: 135, percent: null },
      repMaxes: [],
    });
    expect(s).toMatchObject({ load: 135, basis: "explicit" });
  });
});
