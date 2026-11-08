import { describe, expect, it } from "vitest";
import {
  collapseToBestSet,
  exerciseLabels,
  countDoneEntries,
  topSetPosition,
  type PrescribedSet,
} from "@/lib/training-resolver";
import type { WorkoutExercise, WorkoutSet } from "@/lib/queries";

const ex = (id: string, extra: Partial<WorkoutExercise> = {}) =>
  ({ id, percent: null, load: null, ...extra }) as unknown as WorkoutExercise;
const row = (extra: Partial<WorkoutSet>) => ({ percent: null, load: null, ...extra }) as WorkoutSet;
const sets = (exercise: WorkoutExercise, rows: Partial<WorkoutSet>[]): PrescribedSet[] =>
  rows.map((r, i) => ({
    exercise,
    setPosition: i + 1,
    setTotal: rows.length,
    setRow: row(r),
  }));

describe("topSetPosition", () => {
  it("picks the set with the highest % of max", () => {
    const s = sets(ex("a"), [{ percent: 70 }, { percent: 80 }, { percent: 75 }]);
    expect(topSetPosition(s)).toBe(2);
  });
  it("falls back to the highest written weight", () => {
    const s = sets(ex("a"), [{ load: 95 }, { load: 135 }, { load: 115 }]);
    expect(topSetPosition(s)).toBe(2);
  });
  it("uses the last set when nothing says which is heaviest", () => {
    const s = sets(ex("a"), [{}, {}, {}]);
    expect(topSetPosition(s)).toBe(3);
  });
  it("gives the later set a tie (3x5 at 80% logs set 3)", () => {
    const s = sets(ex("a"), [{ percent: 80 }, { percent: 80 }, { percent: 80 }]);
    expect(topSetPosition(s)).toBe(3);
  });
  it("handles a single set and an empty list", () => {
    expect(topSetPosition(sets(ex("a"), [{ percent: 60 }]))).toBe(1);
    expect(topSetPosition([])).toBe(1);
  });
});

describe("collapseToBestSet", () => {
  const bench = ex("bench");
  const jump = ex("jump");
  const list = [
    ...sets(bench, [{ percent: 70 }, { percent: 80 }, { percent: 90 }]),
    ...sets(jump, [{}, {}, {}]),
  ];
  const isLift = (e: WorkoutExercise) => e.id === "bench";

  it("keeps one entry for a lift and every set of the other kinds", () => {
    const out = collapseToBestSet(list, isLift);
    expect(out.filter((p) => p.exercise.id === "bench")).toHaveLength(1);
    expect(out.find((p) => p.exercise.id === "bench")!.setPosition).toBe(3);
    expect(out.filter((p) => p.exercise.id === "jump")).toHaveLength(3);
  });
  it("keeps workout order", () => {
    const out = collapseToBestSet(list, isLift).map((p) => p.exercise.id);
    expect(out).toEqual(["bench", "jump", "jump", "jump"]);
  });
  it("leaves everything alone when nothing is a best-set lift", () => {
    expect(collapseToBestSet(list, () => false)).toHaveLength(6);
  });
});

describe("countDoneEntries", () => {
  const bench = ex("bench");
  const jump = ex("jump");
  const isLift = (e: WorkoutExercise) => e.id === "bench";
  const entries = collapseToBestSet(
    [...sets(bench, [{ percent: 70 }, { percent: 90 }]), ...sets(jump, [{}, {}])],
    isLift,
  );
  const log = (id: string, pos: number, status = "completed") => ({
    workout_exercise_id: id,
    set_position: pos,
    status,
  });
  it("counts a lift done from any one completed log, even an older set-by-set one", () => {
    expect(countDoneEntries(entries, [log("bench", 1)], isLift)).toBe(1);
  });
  it("needs the exact set for the other kinds", () => {
    expect(countDoneEntries(entries, [log("jump", 1)], isLift)).toBe(1);
    expect(countDoneEntries(entries, [log("jump", 1), log("jump", 2)], isLift)).toBe(2);
  });
  it("ignores skipped sets and logs for other exercises", () => {
    expect(countDoneEntries(entries, [log("bench", 2, "skipped"), log("zzz", 1)], isLift)).toBe(0);
  });
});

describe("exerciseLabels", () => {
  const e = (id: string, g: string | null = null) => ({ id, superset_group: g });
  it("numbers only supersets: A, B, C1, C2, D", () => {
    const m = exerciseLabels([e("squat"), e("bench"), e("press", "C"), e("pull", "C"), e("jump")]);
    expect([...m.values()]).toEqual(["A", "B", "C1", "C2", "D"]);
  });
  it("labels a plain workout A, B, C", () => {
    const m = exerciseLabels([e("a"), e("b"), e("c")]);
    expect([...m.values()]).toEqual(["A", "B", "C"]);
  });
  it("handles a three-way superset and an empty list", () => {
    expect([...exerciseLabels([e("x", "A"), e("y", "A"), e("z", "A")]).values()]).toEqual(["A1", "A2", "A3"]);
    expect(exerciseLabels([]).size).toBe(0);
  });
});
