import { describe, expect, it } from "vitest";
import { findAthleteDuplicateGroups } from "@/lib/validation";
import {
  conflicting,
  findNicknameGroups,
  firstLastKey,
  firstNamesRelated,
  lastNamesSimilar,
  nicknameCandidateReasons,
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

describe("firstNamesRelated", () => {
  it("knows nickname pairs and short forms", () => {
    expect(firstNamesRelated("Mike", "Michael")).toBe(true);
    expect(firstNamesRelated("Bill", "William")).toBe(true);
    expect(firstNamesRelated("Chuy", "Jesus")).toBe(true);
    expect(firstNamesRelated("DJ", "Daniel")).toBe(true);
    expect(firstNamesRelated("Bo", "Beauregard")).toBe(true);
  });
  it("does not relate different people", () => {
    expect(firstNamesRelated("Mike", "Marcus")).toBe(false);
    expect(firstNamesRelated("Jose", "Carlos")).toBe(false);
  });
});

describe("lastNamesSimilar", () => {
  it("allows one typo and compound names, not different names", () => {
    expect(lastNamesSimilar("Hernandez", "Hernandes")).toBe(true);
    expect(lastNamesSimilar("Garcia", "Garcia Lopez")).toBe(true);
    expect(lastNamesSimilar("Smith", "Smyth")).toBe(true);
    expect(lastNamesSimilar("Smith", "Jones")).toBe(false);
  });
});

describe("nicknameCandidateReasons / findNicknameGroups", () => {
  const kid = (id: string, first: string, last: string, over: Record<string, unknown> = {}) => ({
    id,
    name: `${first} ${last}`,
    first_name: first,
    last_name: last,
    grade: 11,
    team_id: "t1",
    sport: "Football",
    ...over,
  });
  it("offers a nickname and a legal first name on the same team and grade", () => {
    const g = findNicknameGroups([
      kid("1", "Mike", "Smith"),
      kid("2", "Michael", "Smith"),
      kid("3", "Jo", "Park"),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].members.map((m) => m.id).sort()).toEqual(["1", "2"]);
    expect(g[0].hint).toContain("First names look related");
  });
  it("offers unrelated first names only when grade and team match", () => {
    expect(findNicknameGroups([kid("1", "Tank", "Lee"), kid("2", "Jarvis", "Lee")])).toHaveLength(
      1,
    );
    expect(
      findNicknameGroups([
        kid("1", "Tank", "Lee"),
        kid("2", "Jarvis", "Lee", { team_id: "t2", sport: "Soccer" }),
      ]),
    ).toHaveLength(0);
  });
  it("leaves brothers in different grades alone", () => {
    expect(
      findNicknameGroups([
        kid("1", "Mike", "Smith", { grade: 9 }),
        kid("2", "Michael", "Smith", { grade: 12 }),
      ]),
    ).toHaveLength(0);
  });
  it("never offers records with different student IDs or graduation years", () => {
    expect(
      nicknameCandidateReasons(
        kid("1", "Mike", "Smith", { student_id: "1" }),
        kid("2", "Michael", "Smith", { student_id: "2" }),
      ),
    ).toBeNull();
    expect(
      nicknameCandidateReasons(
        kid("1", "Mike", "Smith", { graduation_year: 2027 }),
        kid("2", "Michael", "Smith", { graduation_year: 2029 }),
      ),
    ).toBeNull();
  });
  it("uses the nickname field too, and a shared student ID", () => {
    const r = nicknameCandidateReasons(
      kid("1", "Quentin", "Ware", { preferred_name: "Q", grade: 10 }),
      kid("2", "Q", "Ware", { grade: null, team_id: null, sport: null }),
    );
    expect(r).not.toBeNull();
    expect(
      nicknameCandidateReasons(
        kid("1", "Tank", "Lee", { student_id: "9" }),
        kid("2", "Jarvis", "Lee", { student_id: "9", grade: null, team_id: null, sport: null }),
      ),
    ).not.toBeNull();
  });
  it("groups a nickname trio into one group", () => {
    const g = findNicknameGroups([
      kid("1", "Mike", "Smith"),
      kid("2", "Michael", "Smith"),
      kid("3", "Mikey", "Smith"),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].members).toHaveLength(3);
  });
});

describe("findAthleteDuplicateGroups", () => {
  const p = (id: string, first: string, last: string, over: Record<string, unknown> = {}) => ({
    id,
    name: `${first} ${last}`,
    first_name: first,
    last_name: last,
    ...over,
  });
  it("does not call similar names with different student IDs the same person", () => {
    const g = findAthleteDuplicateGroups([
      p("1", "Jose", "Garcia", { student_id: "1" }),
      p("2", "Josue", "Garcia", { student_id: "2" }),
    ]);
    expect(g).toHaveLength(0);
  });
  it("still groups similar names when nothing says they differ", () => {
    expect(
      findAthleteDuplicateGroups([p("1", "Jose", "Garcia"), p("2", "Josue", "Garcia")]),
    ).toHaveLength(1);
  });
  it("puts an exact first+last repeat in its own group before the nickname pass", () => {
    const g = findAthleteDuplicateGroups([
      p("1", "Mike", "Smith"),
      p("2", "Mike", "Smith"),
      p("3", "Michael", "Smith"),
    ]);
    expect(g[0].reason).toBe("first_last");
  });
});
