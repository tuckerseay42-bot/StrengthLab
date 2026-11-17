import { describe, expect, it } from "vitest";
import {
  conflicting,
  firstLastKey,
  pickKeeper,
  planFirstLastMerges,
  type DedupeAthlete,
  type History,
} from "@/lib/athlete-dedupe";

const a = (id: string, over: Partial<DedupeAthlete> = {}): DedupeAthlete => ({
  id,
  name: "Abreham Evans",
  first_name: "Abreham",
  last_name: "Evans",
  created_at: "2026-08-01T00:00:00Z",
  ...over,
});
const none = new Map<string, History>();

describe("firstLastKey", () => {
  it("ignores case, punctuation and Jr/Sr", () => {
    expect(firstLastKey(a("1"))).toBe(
      firstLastKey(a("2", { first_name: "ABREHAM", last_name: "evans Jr." })),
    );
  });
  it("uses the first/last fields even when the old name field disagrees", () => {
    expect(firstLastKey(a("1", { name: "Abe E" }))).toBe("abreham|evans");
  });
  it("falls back to splitting the name when first/last are empty", () => {
    expect(
      firstLastKey({ id: "x", name: "Abreham Evans", first_name: null, last_name: null }),
    ).toBe("abreham|evans");
  });
  it("has no key for a one-word name", () => {
    expect(firstLastKey({ id: "x", name: "Cher", first_name: null, last_name: null })).toBeNull();
  });
});

describe("conflicting", () => {
  it("different student IDs or graduation years mean different kids", () => {
    expect(conflicting(a("1", { student_id: "1" }), a("2", { student_id: "2" }))).toBe(true);
    expect(conflicting(a("1", { graduation_year: 2027 }), a("2", { graduation_year: 2029 }))).toBe(
      true,
    );
  });
  it("a missing ID or year is not a conflict", () => {
    expect(conflicting(a("1", { student_id: "1" }), a("2"))).toBe(false);
    expect(
      conflicting(
        a("1", { student_id: "1", graduation_year: 2027 }),
        a("2", { student_id: "1", graduation_year: 2027 }),
      ),
    ).toBe(false);
  });
});

describe("pickKeeper", () => {
  it("keeps the record with the most history", () => {
    const h = new Map<string, History>([
      ["1", { tests: 0, lifts: 1, attendance: 2 }],
      ["2", { tests: 3, lifts: 9, attendance: 20 }],
    ]);
    expect(pickKeeper([a("1"), a("2")], h).id).toBe("2");
  });
  it("on equal history prefers the one linked to a login, then the oldest", () => {
    expect(pickKeeper([a("1"), a("2", { user_id: "u" })], none).id).toBe("2");
    expect(
      pickKeeper([a("1", { created_at: "2026-09-01" }), a("2", { created_at: "2026-08-01" })], none)
        .id,
    ).toBe("2");
  });
});

describe("planFirstLastMerges", () => {
  it("plans one merge for a repeated import and leaves unique kids alone", () => {
    const list = [a("1"), a("2"), a("3", { name: "Jo Park", first_name: "Jo", last_name: "Park" })];
    const { merges, needsReview } = planFirstLastMerges(list, none);
    expect(merges).toHaveLength(1);
    expect(merges[0].drop).toHaveLength(1);
    expect(needsReview).toHaveLength(0);
  });
  it("merges 3 copies into one keeper", () => {
    const { merges } = planFirstLastMerges([a("1"), a("2"), a("3")], none);
    expect(merges).toHaveLength(1);
    expect(merges[0].drop).toHaveLength(2);
  });
  it("keeps same-name kids with different student IDs apart and flags them", () => {
    const { merges, needsReview } = planFirstLastMerges(
      [a("1", { student_id: "100" }), a("2", { student_id: "200" })],
      none,
    );
    expect(merges).toHaveLength(0);
    expect(needsReview).toHaveLength(1);
  });
  it("still merges the copies of each real kid when two same-name kids both have duplicates", () => {
    const list = [
      a("1", { student_id: "100" }),
      a("2", { student_id: "100" }),
      a("3", { student_id: "200" }),
      a("4", { student_id: "200" }),
    ];
    const { merges, needsReview } = planFirstLastMerges(list, none);
    expect(merges).toHaveLength(2);
    expect(needsReview).toHaveLength(1);
  });
});
