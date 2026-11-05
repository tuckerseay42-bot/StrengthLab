import { describe, expect, it } from "vitest";
import { fetchAll, PAGE } from "@/lib/fetch-all";

type Row = { id: number; position: number };

// A stand-in for the database: returns rows in a stable sorted order, a page at a time,
// the way the Data API does when the query has a unique sort.
function fakeTable(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => a.position - b.position || a.id - b.id);
  return () => ({
    range: async (from: number, to: number) => ({
      data: sorted.slice(from, to + 1),
      error: null,
    }),
  });
}

const makeRows = (n: number): Row[] =>
  // Lots of ties on `position`, like workout sets where most rows are position 1 or 2.
  Array.from({ length: n }, (_, i) => ({ id: i + 1, position: (i % 4) + 1 }));

describe("fetchAll", () => {
  it("returns every row of a table bigger than one page, each exactly once", async () => {
    const rows = makeRows(2350);
    const got = await fetchAll<Row>(fakeTable(rows));
    expect(got).toHaveLength(2350);
    expect(new Set(got.map((r) => r.id)).size).toBe(2350);
  });

  it("does not stop early when a table is exactly one page long", async () => {
    const got = await fetchAll<Row>(fakeTable(makeRows(PAGE)));
    expect(got).toHaveLength(PAGE);
  });

  it("handles an empty table and a small one", async () => {
    expect(await fetchAll<Row>(fakeTable([]))).toEqual([]);
    expect(await fetchAll<Row>(fakeTable(makeRows(7)))).toHaveLength(7);
  });

  it("passes a database error up instead of returning half a list", async () => {
    await expect(
      fetchAll<Row>(() => ({
        range: async () => ({ data: null, error: { message: "boom" } }),
      })),
    ).rejects.toMatchObject({ message: "boom" });
  });

  it("shows why a single request is not enough: a plain request keeps only the first page", () => {
    const rows = makeRows(2350);
    const onePage = fakeTable(rows)().range(0, PAGE - 1);
    return onePage.then(({ data }) => {
      expect((data as Row[]).length).toBe(PAGE);
      expect((data as Row[]).length).toBeLessThan(rows.length);
    });
  });

  it("asks for later pages at the same time, and keeps rows in order", async () => {
    const rows = makeRows(PAGE * 6 + 17);
    const sorted = [...rows].sort((a, b) => a.position - b.position || a.id - b.id);
    let inFlight = 0;
    let peak = 0;
    const got = await fetchAll<Row>(() => ({
      range: async (from: number, to: number) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { data: sorted.slice(from, to + 1), error: null };
      },
    }));
    expect(peak).toBeGreaterThan(1);
    expect(got).toEqual(sorted);
  });

  it("stops correctly when the table ends exactly on a batch boundary", async () => {
    const got = await fetchAll<Row>(fakeTable(makeRows(PAGE * 5)));
    expect(got).toHaveLength(PAGE * 5);
    expect(new Set(got.map((r) => r.id)).size).toBe(PAGE * 5);
  });
});
